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

async function subscribeToOrderCreated() {
  // бронирование лицензии на продукт при заведении заказа
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("store_events", "topic", { durable: true });
  await channel.assertQueue("store_order_created", { durable: true });
  await channel.bindQueue(
    "store_order_created",
    "store_events",
    "order.created"
  );

  channel.consume("store_order_created", async (msg) => {
    if (!msg) return;

    try {
      const data = JSON.parse(msg.content.toString());
      const { userId, orderId, productId } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        const alreadyTakenLicense = await client
          .query(
            "SELECT 1 FROM licenses WHERE productid = $1 AND userid = $2 AND orderid != $3",
            [productId, userId, orderId]
          )
          .then((res) => res.rows[0]);
        if (alreadyTakenLicense) {
          sendToRabbitEchange("orders_events", "orders.updated", {
            orderId,
            productId,
            status: "cancelled",
            comment: "Лицензия уже забронирована в рамках иного заказа",
          });
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        const freeLicense = await client
          .query(
            "SELECT productid, licenseid FROM licenses WHERE productid = $1 AND userid is null LIMIT 1",
            [productId]
          )
          .then((res) => res.rows[0]);

        if (!freeLicense) {
          sendToRabbitEchange("orders_events", "orders.updated", {
            orderId,
            productId,
            status: "cancelled",
            comment: "Нет свободных лицензий",
          });
          await client.query("COMMIT");
          channel.ack(msg);
          return;
        }

        await client.query(
          "UPDATE licenses SET userid = $1, orderid = $2 WHERE productid = $3 and licenseid = $4",
          [userId, orderId, productId, freeLicense.licenseid]
        );

        const product = await client
          .query("SELECT sellerid, price, type FROM products WHERE id = $1", [
            productId,
          ])
          .then((res) => res.rows[0]);

        await client.query("COMMIT");

        sendToRabbitEchange("billing_events", "orders.created", {
          orderId,
          userId,
          productId,
          sellerId: product.sellerId,
          productType: product.type,
          productPrice: product.price,
          licenseId: freeLicense.licenseid,
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

app.get("/v1/products/:id", async (req, res) => {
  const { id } = req.params;

  // Проверка, что id — число
  if (!/^\d+$/.test(id)) {
    return res.status(400).send("Некорректный id продукта");
  }

  try {
    const result = await postgresql.query(
      `SELECT id, title, description, type, price, sellerid, systemrequirements, createdate
       FROM products
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Продукт не найден");
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка при получении продукта:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Store service running on port ${APP_PORT}`)
);

subscribeToOrderCreated();
