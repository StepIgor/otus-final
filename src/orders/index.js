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


// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Orders service running on port ${APP_PORT}`)
);
