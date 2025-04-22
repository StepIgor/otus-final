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

async function subscribeToNotificationCreated() {
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("notifications_events", "topic", {
    durable: true,
  });
  await channel.assertQueue("notifications_notification_created", {
    durable: true,
  });
  await channel.bindQueue(
    "notifications_notification_created",
    "notifications_events",
    "notifications.created"
  );

  channel.consume("notifications_notification_created", async (msg) => {
    if (!msg) return;
    try {
      const { uuid, userId, text } = JSON.parse(msg.content.toString());

      await postgresql.query(
        "INSERT INTO notifications (id, userid, text) VALUES ($1, $2, $3)",
        [uuid, userId, text]
      );
      await redis.incr(`notifications:unread:${userId}`);
    } catch (err) {
      console.error("Ошибка регистрации уведомления:", err.message);
    } finally {
      channel.ack(msg);
    }
  });
}

// ENDPOINTS
app.get("/v1/all", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `SELECT id, text, createdate FROM notifications WHERE userid = $1 ORDER BY createdate DESC`,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении уведомлений:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/unread-count", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    const count = await redis.get(`notifications:unread:${userId}`);
    return res.json({ unread: Number(count) || 0 });
  } catch (err) {
    console.error("Ошибка при получении счётчика уведомлений:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/mark-read", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    await redis.del(`notifications:unread:${userId}`);
    return res.status(200).send("Счётчик уведомлений сброшен");
  } catch (err) {
    console.error("Ошибка при сбросе счётчика уведомлений:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Notifications service running on port ${APP_PORT}`)
);

subscribeToNotificationCreated();
