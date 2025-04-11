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

// ENDPOINTS
app.get("/v1/balance", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId) {
    return res.status(400).send("Не передан заголовок X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `
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
      `,
      [userId]
    );

    const balance = result.rows[0].balance;

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
  console.log(`Users service running on port ${APP_PORT}`)
);

await subscribeToUserCreated();
