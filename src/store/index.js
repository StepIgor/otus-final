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
app.get("/v1/products", async (req, res) => {
  const { search, type, minPrice, maxPrice } = req.query;

  const conditions = [];

  if (search) {
    const escapedSearch = search
      .replace(/%/gi, "\\%")
      .replace(/_/gi, "\\_")
      .replace(/'/gi, "\\'");
    conditions.push(
      `(title ILIKE '%${escapedSearch}%' OR description ILIKE '%${escapedSearch}%')`
    );
  }

  if (type === "digital" || type === "physical") {
    conditions.push(`type = '${type}'`);
  }

  if (minPrice && !isNaN(minPrice)) {
    conditions.push(`price >= ${minPrice}`);
  }

  if (maxPrice && !isNaN(maxPrice)) {
    conditions.push(`price <= ${maxPrice}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const result = await postgresql.query(
      `SELECT id, title, description, type, price, systemrequirements, sellerid, createdate
        FROM products
        ${where}
        ORDER BY createdate DESC`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении списка товаров:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Store service running on port ${APP_PORT}`)
);
