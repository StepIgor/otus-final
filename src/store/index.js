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
            userId,
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
            userId,
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
          .query(
            "SELECT sellerid, price, type, title FROM products WHERE id = $1",
            [productId]
          )
          .then((res) => res.rows[0]);

        await client.query("COMMIT");

        sendToRabbitEchange("billing_events", "orders.created", {
          uuid: uuidv4(),
          orderId,
          userId,
          productId,
          sellerId: product.sellerid,
          productType: product.type,
          productPrice: product.price,
          productTitle: product.title,
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

async function subscribeToOrderUpdated() {
  // снятие брони на лицензию при неудачной оплате
  const connection = await amqplib.connect(RABBIT_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange("store_events", "topic", { durable: true });
  await channel.assertQueue("store_order_updated", { durable: true });
  await channel.bindQueue(
    "store_order_updated",
    "store_events",
    "orders.updated"
  );

  channel.consume("store_order_updated", async (msg) => {
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
        status,
        comment,
      } = data;

      const client = await postgresql.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          "UPDATE licenses SET userid = null, orderid = null WHERE productid = $1 AND licenseid = $2 AND userid = $3 AND orderid = $4",
          [productId, licenseId, userId, orderId]
        );

        await client.query("COMMIT");
        sendToRabbitEchange("orders_events", "orders.updated", {
          orderId,
          productId,
          sellerId,
          licenseId,
          price: productPrice,
          status,
          userId,
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

app.get("/v1/seller/products", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");

  // Проверка заголовков
  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  try {
    const result = await postgresql.query(
      `SELECT id, title, description, type, price, systemrequirements, createdate
       FROM products
       WHERE sellerid = $1
       ORDER BY createdate DESC`,
      [userId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении товаров продавца:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.put("/v1/seller/products/:id", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");
  const productId = req.params.id;
  const { title, description, price, systemrequirements } = req.body;

  // Проверка доступа
  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (!productId || isNaN(Number(productId))) {
    return res.status(400).send("Некорректный id продукта");
  }

  // Проверка тела запроса
  if (!title || !description || !price || !systemrequirements) {
    return res
      .status(400)
      .send(
        "Не все поля заполнены (title, description, price, systemrequirements)"
      );
  }

  try {
    // Проверка принадлежности товара
    const check = await postgresql.query(
      `SELECT id FROM products WHERE id = $1 AND sellerid = $2`,
      [productId, userId]
    );

    if (check.rowCount === 0) {
      return res.status(403).send("Продукт не найден или не принадлежит вам");
    }

    const sameNameProduct = await postgresql
      .query("SELECT 1 FROM products WHERE title = $1 AND id != $2", [
        title,
        productId,
      ])
      .then((res) => res.rows[0]);

    if (sameNameProduct) {
      return res
        .status(400)
        .send("Товар с таким наименованием уже представлен в каталоге");
    }

    // Обновление товара
    const result = await postgresql.query(
      `UPDATE products
       SET title = $1,
           description = $2,
           price = $3,
           systemrequirements = $4
       WHERE id = $5
       RETURNING id, title, description, type, price, systemrequirements, createdate`,
      [title, description, price, systemrequirements, productId]
    );

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка при обновлении продукта:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/seller/products", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");

  const { title, description, type, price, systemrequirements } = req.body;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (
    !title ||
    !description ||
    !type ||
    !price ||
    !systemrequirements ||
    !["digital", "physical"].includes(type)
  ) {
    return res
      .status(400)
      .send(
        "Отсутствуют или некорректны обязательные поля (title, description, type: digital/physical, price, systemrequirements)"
      );
  }

  try {
    const result = await postgresql.query(
      `INSERT INTO products
         (title, description, type, price, sellerid, systemrequirements)
       VALUES
         ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, type, price, sellerid, systemrequirements, createdate`,
      [title, description, type, price, userId, systemrequirements]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      // unique_violation (например, title уже существует)
      return res.status(409).send("Продукт с таким названием уже существует");
    }

    console.error("Ошибка при добавлении продукта:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/seller/products/:id/licenses", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");
  const productId = req.params.id;
  const { amount } = req.body;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (!productId || isNaN(Number(productId))) {
    return res.status(400).send("Некорректный productId");
  }

  if (!amount || isNaN(Number(amount)) || amount < 1) {
    return res.status(400).send("Неверное значение amount");
  }

  const client = await postgresql.connect();

  try {
    await client.query("BEGIN");

    // Проверка, что товар принадлежит продавцу
    const productCheck = await client.query(
      `SELECT id FROM products WHERE id = $1 AND sellerid = $2`,
      [productId, userId]
    );

    if (productCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).send("Продукт не найден или не принадлежит вам");
    }

    // Получаем последнее значение licenseid
    const last = await client.query(
      `SELECT MAX(licenseid) AS max FROM licenses WHERE productid = $1`,
      [productId]
    );

    const startFrom = (last.rows[0]?.max || 0) + 1;
    const values = [];

    for (let i = 0; i < amount; i++) {
      values.push(`(${productId}, ${startFrom + i})`);
    }

    const insertSQL = `
      INSERT INTO licenses (productid, licenseid)
      VALUES ${values.join(", ")}
      ON CONFLICT DO NOTHING
    `;

    await client.query(insertSQL);

    await client.query("COMMIT");

    return res.status(201).json({
      message: `Добавлено ${amount} лицензий к продукту ${productId}`,
      licenseIds: Array.from({ length: amount }, (_, i) => startFrom + i),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка при добавлении лицензий:", error);
    return res.status(500).send("Ошибка сервера");
  } finally {
    client.release();
  }
});

app.get("/v1/seller/products/:id/licenses", async (req, res) => {
  const userId = req.header("X-User-Id");
  const role = req.header("X-User-Role-Name");
  const productId = req.params.id;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (role !== "seller") {
    return res.status(403).send("Доступ разрешён только продавцам");
  }

  if (!productId || isNaN(Number(productId))) {
    return res.status(400).send("Некорректный productId");
  }

  try {
    // Проверка, принадлежит ли продукт продавцу
    const check = await postgresql.query(
      `SELECT id FROM products WHERE id = $1 AND sellerid = $2`,
      [productId, userId]
    );

    if (check.rowCount === 0) {
      return res.status(403).send("Продукт не найден или не принадлежит вам");
    }

    const result = await postgresql.query(
      `SELECT productid, licenseid, userid, orderid
       FROM licenses
       WHERE productid = $1
       ORDER BY licenseid`,
      [productId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении лицензий:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Store service running on port ${APP_PORT}`)
);

subscribeToOrderCreated();
subscribeToOrderUpdated();
