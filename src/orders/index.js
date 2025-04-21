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

async function subscribeToOrderUpdated() {
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("orders_events", "topic", { durable: true });
  await channel.assertQueue("orders_order_updated", { durable: true });
  await channel.bindQueue(
    "orders_order_updated",
    "orders_events",
    "orders.updated"
  );

  channel.consume("orders_order_updated", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const {
        orderId,
        status,
        comment,
        sellerId,
        licenseId,
        productId,
        price,
      } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          "UPDATE orders SET status = $1, comment = $2, sellerid = $3, licenseid = $4, productid = $5, price = $6 WHERE id = $7",
          [status, comment, sellerId, licenseId, productId, price, orderId]
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
app.get("/v1/orders", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(401).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `SELECT id, productid, price, status, comment, createdate
       FROM orders
       WHERE userid = $1
       ORDER BY id DESC`,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении заказов:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/orders", async (req, res) => {
  const userId = req.header("X-User-Id");
  const { productid, requestId } = req.body;

  // Проверки
  if (!userId || isNaN(Number(userId))) {
    return res.status(401).send("Неверный или отсутствующий X-User-Id");
  }

  if (!productid || isNaN(Number(productid))) {
    return res.status(400).send("Неверный или отсутствующий productid");
  }

  if (!requestId || typeof requestId !== "string") {
    return res.status(400).send("Отсутствует requestId");
  }

  const redisKey = `order:req:${requestId}`;

  try {
    // Проверка, был ли уже такой запрос
    const existingOrderId = await redis.get(redisKey);

    if (existingOrderId) {
      const order = await postgresql
        .query(
          `SELECT id, userid, productid, status, comment
           FROM orders
           WHERE id = $1`,
          [existingOrderId]
        )
        .then((res) => res.rows[0]);

      if (order) return res.status(200).json(order);
    }

    const order = await postgresql
      .query(
        `INSERT INTO orders (userid, productid, status)
       VALUES ($1, $2, 'processing')
       RETURNING id, userid, productid, status, comment`,
        [userId, productid]
      )
      .then((res) => res.rows[0]);

    // Сохраняем UUID → orderId в Redis (на 24 часа)
    await redis.set(redisKey, order.id, "EX", 60 * 60 * 24);

    sendToRabbitEchange("store_events", "order.created", {
      orderId: order.id,
      userId: order.userid,
      productId: order.productid,
    });

    return res.status(201).json(order);
  } catch (error) {
    console.error("Ошибка при создании заказа:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/seller/orders/pending", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  try {
    const result = await postgresql.query(
      `SELECT id, userid, productid, licenseid, price, comment, createdate
       FROM orders
       WHERE sellerid = $1 AND status = 'pending'
       ORDER BY createdate DESC`,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении заказов продавца:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.put("/v1/seller/orders/:id/complete", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");
  const orderId = req.params.id;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(400).send("Неверный идентификатор заказа");
  }

  const client = await postgresql.connect();

  try {
    await client.query("BEGIN");

    // Проверяем, принадлежит ли заказ этому продавцу и находится ли в статусе 'pending'
    const check = await client.query(
      `SELECT id FROM orders
       WHERE id = $1 AND sellerid = $2 AND status = 'pending'`,
      [orderId, userId]
    );

    if (check.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .send("Заказ не найден или недоступен для обработки");
    }

    // Обновляем статус и комментарий
    const result = await client.query(
      `UPDATE orders
       SET status = 'done',
           comment = 'Копия доставлена покупателю'
       WHERE id = $1
       RETURNING id, userid, productid, status, comment, createdate`,
      [orderId]
    );

    await client.query("COMMIT");
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка при подтверждении доставки:", error);
    return res.status(500).send("Ошибка сервера");
  } finally {
    client.release();
  }
});

app.put("/v1/seller/orders/:id/decline", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");
  const orderId = req.params.id;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (!orderId || isNaN(Number(orderId))) {
    return res.status(400).send("Неверный идентификатор заказа");
  }

  const client = await postgresql.connect();

  try {
    await client.query("BEGIN");

    // Проверяем, принадлежит ли заказ этому продавцу и находится ли в статусе 'pending'
    const order = await client
      .query(
        `SELECT id, userid, productid, licenseid, sellerid, price FROM orders
       WHERE id = $1 AND sellerid = $2 AND status = 'pending'`,
        [orderId, userId]
      )
      .then((res) => res.rows[0]);

    if (!order) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .send("Заказ не найден или недоступен для обработки");
    }
    await client.query("COMMIT");

    const redisKey = `order:decline_orderid:${orderId}`;
    const existingOrderId = await redis.get(redisKey);
    if (existingOrderId) {
      return res.sendStatus(200);
    }

    // Откатываем списание денег, снимаем бронь с лицензии. Запись в таблице будет обновлять orders.updated
    sendToRabbitEchange("billing_events", "orders.updated", {
      orderId,
      userId: order.userid,
      productId: order.productid,
      licenseId: order.licenseid,
      sellerId: order.sellerid,
      price: order.price,
      uuid: uuidv4(), // refund покупателю
      status: "cancelled",
      comment: "Отменён продавцом",
    });
    await redis.set(redisKey, orderId, "EX", 60 * 60 * 24);

    return res.sendStatus(200);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка при отклонении заказа:", error);
    return res.status(500).send("Ошибка сервера");
  } finally {
    client.release();
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Orders service running on port ${APP_PORT}`)
);

subscribeToOrderUpdated();
