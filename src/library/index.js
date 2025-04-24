import express from "express";
import pg from "pg";
const { Pool } = pg;
import Redis from "ioredis";
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

// Отправка сообщений в RabbitMQ
async function sendToRabbitExchange(exchange, routingKey, message) {
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

async function subscribeToOrderCreated() {
  // добавление цифрового товра в библиотеку
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("library_events", "topic", { durable: true });
  await channel.assertQueue("library_order_created", { durable: true });
  await channel.bindQueue(
    "library_order_created",
    "library_events",
    "orders.created"
  );

  channel.consume("library_order_created", async (msg) => {
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

        const sameLicenseAdded = await client
          .query(
            "SELECT 1 FROM library WHERE userid = $1 AND productid = $2 AND licenseid = $3",
            [userId, productId, licenseId]
          )
          .then((res) => res.rows[0]);

        if (sameLicenseAdded) {
          sendToRabbitExchange("orders_events", "orders.updated", {
            orderId,
            userId,
            productId,
            sellerId,
            price: productPrice,
            licenseId,
            status: "done",
            comment: "Продукт уже в вашей библиотеке",
          });
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        await client.query(
          "INSERT INTO library (userid, productid, licenseid) VALUES ($1, $2, $3)",
          [userId, productId, licenseId]
        );

        sendToRabbitExchange("orders_events", "orders.updated", {
          orderId,
          userId,
          productId,
          sellerId,
          price: productPrice,
          licenseId,
          status: "done",
          comment: "Продукт добавлен в библиотеку",
        });
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

async function subscribeToOrderCompleted() {
  // регистрация лицензии на физический товар (заказ уже завершён)
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("library_events", "topic", { durable: true });
  await channel.assertQueue("library_order_completed", { durable: true });
  await channel.bindQueue(
    "library_order_completed",
    "library_events",
    "orders.completed"
  );

  channel.consume("library_order_completed", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const { userId, productId, licenseId } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        const sameLicenseAdded = await client
          .query(
            "SELECT 1 FROM library WHERE userid = $1 AND productid = $2 AND licenseid = $3",
            [userId, productId, licenseId]
          )
          .then((res) => res.rows[0]);

        if (sameLicenseAdded) {
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        await client.query(
          "INSERT INTO library (userid, productid, licenseid) VALUES ($1, $2, $3)",
          [userId, productId, licenseId]
        );
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

// ENDPOINTS
app.get("/v1/products", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Некорректный или отсутствующий X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `SELECT productid, licenseid
       FROM library
       WHERE userid = $1`,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении библиотеки:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/library/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);

  if (!userId || isNaN(userId)) {
    return res.status(400).send("Некорректный userId");
  }

  try {
    const result = await postgresql.query(
      `SELECT productid, licenseid
       FROM library
       WHERE userid = $1
       ORDER BY productid`,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении библиотеки:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Library service running on port ${APP_PORT}`)
);

subscribeToOrderCreated();
subscribeToOrderCompleted();
