import express from "express";
import pg from "pg";
const { Pool } = pg;
import Redis from "ioredis";
import cors from "cors";
import amqplib from "amqplib";
import { v4 as uuidv4 } from "uuid";

const APP_PORT = process.env.APP_PORT;
const RABBIT_URL = `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PSWD}@${process.env.RABBITMQ_HOST}`;

const app = express();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PSWD,
});
const postgresql = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_NAME,
  password: process.env.POSTGRES_PSWD,
  port: process.env.POSTGRES_PORT,
});

app.use(express.json());

const USER_BALANCE_QUERY_TEXT = `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN type = 'DEPOSIT' THEN amount
            WHEN type = 'REFUND' THEN amount
            WHEN type = 'PURCHASE' THEN -amount
            ELSE 0
          END
        ), 0) AS balance
      FROM billingevents
      WHERE userid = $1
      `;

async function getUserBalance(userId) {
  return await postgresql
    .query(USER_BALANCE_QUERY_TEXT, [userId])
    .then((res) => res.rows[0].balance);
}

// обновление баланса пользователя в Redis
async function updateUserRedisBalance(userId, newBalance) {
  if (!userId) {
    return;
  }
  try {
    if (newBalance) {
      await redis.set(`balance:${userId}`, newBalance);
      return;
    }
    const userBalance = await getUserBalance(userId);
    await redis.set(`balance:${userId}`, userBalance);
  } catch (error) {
    console.error("Ошибка при обнолвении баланса в Redis:", error.message);
  }
}

// Отправка сообщений в RabbitMQ
async function sendToRabbitEchange(exchange, routingKey, message) {
  try {
    const connection = await amqplib.connect(RABBIT_URL);
    const channel = await connection.createChannel();
    // Объявляем Exchange (тип: topic)
    await channel.assertExchange(exchange, "topic", {
      durable: true,
    });
    // Публикуем сообщение с routing key
    channel.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Ошибка отправки сообщения в RabbitMQ:", error.message);
  }
}

async function subscribeToUserCreated() {
  // бонусное внесение 500 у.е. за регистрацию на счет
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("billing_events", "topic", { durable: true });
  await channel.assertQueue("billing_user_created", { durable: true });
  await channel.bindQueue(
    "billing_user_created",
    "billing_events",
    "user.created"
  );

  channel.consume("billing_user_created", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const userId = data.userId;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        const res = await client.query(
          "SELECT 1 FROM billingevents WHERE userid = $1 AND type = 'DEPOSIT' AND description = 'Initial bonus'",
          [userId]
        );

        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO billingevents (id, userid, type, amount, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [uuidv4(), userId, "DEPOSIT", 500, "Initial bonus"]
          );
        }

        await client.query("COMMIT");
        channel.ack(msg);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Ошибка обработки события:", err.message);
        channel.nack(msg, false, true); // повторить позже (сообщение, применить и на более ранних сообщениях, вернуть в очередь)
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Некорректное сообщение:", err.message);
      channel.nack(msg, false, false); // отбросить
    }
  });
}

async function subscribeToOrderCreated() {
  // попытка списания средств за заказ
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("billing_events", "topic", { durable: true });
  await channel.assertQueue("billing_order_created", { durable: true });
  await channel.bindQueue(
    "billing_order_created",
    "billing_events",
    "orders.created"
  );

  channel.consume("billing_order_created", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const {
        uuid,
        orderId,
        userId,
        productId,
        sellerId,
        productType,
        productPrice,
        productTitle,
        licenseId,
      } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        const theSameUuidEvent = await client
          .query("SELECT 1 FROM billingevents WHERE id = $1", [uuid])
          .then((res) => res.rows[0]);
        if (theSameUuidEvent) {
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        const userBalance = await client
          .query(USER_BALANCE_QUERY_TEXT, [userId])
          .then((res) => res.rows[0].balance);

        if (Number(userBalance) < Number(productPrice)) {
          sendToRabbitEchange("store_events", "orders.updated", {
            uuid,
            orderId,
            userId,
            productId,
            sellerId,
            productType,
            productPrice,
            productTitle,
            licenseId,
            status: "cancelled",
            comment: "Недостаточно средств на балансе",
          });
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        await client.query(
          "INSERT INTO billingevents (id, userid, type, amount, description) VALUES ($1, $2, $3, $4, $5)",
          [
            uuid,
            userId,
            "PURCHASE",
            productPrice,
            `Приобретение ${productTitle}`,
          ]
        );
        await client.query("COMMIT");

        if (productType === "physical") {
          // заказ должен перевести в готовность Издатель
          sendToRabbitEchange("orders_events", "orders.updated", {
            orderId,
            userId,
            productId,
            sellerId,
            price: productPrice,
            licenseId,
            status: "pending",
            comment: "Ожидание подтверждения отправки копии издателем",
          });
        } else {
          // осталось добавить товар в библиотеку пользователя
          sendToRabbitEchange("library_events", "orders.created", {
            uuid,
            orderId,
            userId,
            productId,
            sellerId,
            productType,
            productPrice,
            productTitle,
            licenseId,
          });
        }
        updateUserRedisBalance(userId);

        channel.ack(msg);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Ошибка обработки события:", err.message);
        channel.nack(msg, false, true); // повторить позже (сообщение, применить и на более ранних сообщениях, вернуть в очередь)
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Некорректное сообщение:", err.message);
      channel.nack(msg, false, false); // отбросить
    }
  });
}

async function subscribeToOrderUpdated() {
  // продавец отменил заказ по физ. копии на заключительном этапе, откат
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("billing_events", "topic", { durable: true });
  await channel.assertQueue("billing_order_updated", { durable: true });
  await channel.bindQueue(
    "billing_order_updated",
    "billing_events",
    "orders.updated"
  );

  channel.consume("billing_order_updated", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const {
        uuid,
        orderId,
        userId,
        productId,
        licenseId,
        sellerId,
        price,
        status,
        comment,
      } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        const theSameUuidEvent = await client
          .query("SELECT 1 FROM billingevents WHERE id = $1", [uuid])
          .then((res) => res.rows[0]);
        if (theSameUuidEvent) {
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        await client.query(
          "INSERT INTO billingevents (id, userid, type, amount, description) VALUES ($1, $2, $3, $4, $5)",
          [
            uuid,
            userId,
            "REFUND",
            price,
            `Возврат средств за заказ №${orderId}`,
          ]
        );
        await client.query("COMMIT");
        updateUserRedisBalance(userId);

        sendToRabbitEchange("store_events", "orders.updated", {
          orderId,
          userId,
          productId,
          licenseId,
          sellerId,
          productPrice: price,
          status,
          comment,
        });

        channel.ack(msg);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Ошибка обработки события:", err.message);
        channel.nack(msg, false, true); // повторить позже (сообщение, применить и на более ранних сообщениях, вернуть в очередь)
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Некорректное сообщение:", err.message);
      channel.nack(msg, false, false); // отбросить
    }
  });
}

// ENDPOINTS
app.get("/v1/balance", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId) {
    return res.status(400).send("Не передан заголовок X-User-Id");
  }

  try {
    const cachedBalance = await redis.get(`balance:${userId}`);
    if (cachedBalance !== null) {
      return res.json({ userId, balance: Number(cachedBalance) });
    }

    const balance = await getUserBalance(userId);
    updateUserRedisBalance(userId, balance);

    return res.json({ userId, balance });
  } catch (error) {
    console.error("Ошибка при подсчёте баланса:", error.message);
    return res.status(500).send("Ошибка при получении баланса");
  }
});

app.get("/v1/transactions", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId) {
    return res.status(400).send("Не передан заголовок X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `
      SELECT id, type, amount, description, createdate
      FROM billingevents
      WHERE userid = $1
      ORDER BY createdate DESC
      `,
      [userId]
    );

    return res.json({ userId, transactions: result.rows });
  } catch (error) {
    console.error("Ошибка при получении транзакций:", error.message);
    return res.status(500).send("Ошибка при получении истории транзакций");
  }
});

app.post("/v1/deposit", async (req, res) => {
  const userId = req.header("X-User-Id");
  const { amount, uuid } = req.body;

  if (!userId) {
    return res.status(400).send("Заголовок X-User-Id обязателен");
  }

  if (!uuid) {
    return res.status(400).send("uuid обязателен");
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).send("Сумма должна быть положительным числом");
  }

  try {
    const result = await postgresql.query(
      `INSERT INTO billingevents (id, userid, type, amount, description)
       VALUES ($1, $2, 'DEPOSIT', $3, $4) ON CONFLICT DO NOTHING
       RETURNING id, amount, createdate`,
      [uuid, userId, amount, "Пополнение счета"]
    );

    updateUserRedisBalance(userId);

    return res.status(201).json({
      message: "Баланс успешно пополнен",
      transaction: result.rows[0],
    });
  } catch (error) {
    console.error("Ошибка при пополнении баланса:", error.message);
    return res.status(500).send("Ошибка сервера при пополнении");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Billing service running on port ${APP_PORT}`)
);

subscribeToUserCreated();
subscribeToOrderCreated();
subscribeToOrderUpdated();
