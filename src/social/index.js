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

// ENDPOINTS
app.post("/v1/reviews", async (req, res) => {
  const userId = req.header("X-User-Id");
  const { productid, recommends, text } = req.body;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (!productid || typeof recommends !== "boolean" || !text?.trim()) {
    return res
      .status(400)
      .send(
        "Неверные или неполные данные в теле запроса (productid, recommends, text)"
      );
  }

  try {
    const result = await postgresql.query(
      `INSERT INTO reviews (userid, productid, recommends, text)
       VALUES ($1, $2, $3, $4)
       RETURNING userid, productid, recommends, text, createdate`,
      [userId, productid, recommends, text.trim()]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      // Уникальный ключ (userid, productid) нарушен — уже есть отзыв
      return res.status(409).send("Вы уже оставляли отзыв на этот продукт");
    }
    console.error("Ошибка при публикации отзыва:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/reviews/:productid", async (req, res) => {
  const { productid } = req.params;

  if (!productid || isNaN(Number(productid))) {
    return res.status(400).send("Неверный или отсутствующий productid");
  }

  try {
    const result = await postgresql.query(
      `SELECT userid, recommends, text, createdate
       FROM reviews
       WHERE productid = $1
       ORDER BY createdate DESC`,
      [productid]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении отзывов:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/reviews/:productid/stats", async (req, res) => {
  const { productid } = req.params;

  if (!productid || isNaN(Number(productid))) {
    return res.status(400).send("Неверный или отсутствующий productid");
  }

  try {
    const result = await postgresql.query(
      `SELECT 
         COUNT(*) FILTER (WHERE recommends = true) AS recommend,
         COUNT(*) FILTER (WHERE recommends = false) AS not_recommend
       FROM reviews
       WHERE productid = $1`,
      [productid]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Ошибка при получении статистики отзывов:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/reviews/:productid/my", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));
  const productId = parseInt(req.params.productid);

  if (!userId || isNaN(userId) || !productId || isNaN(productId)) {
    return res.status(400).send("Некорректный userId или productid");
  }

  try {
    const result = await postgresql
      .query(
        `SELECT createdate, recommends, text FROM reviews
       WHERE userid = $1 AND productid = $2
       LIMIT 1`,
        [userId, productId]
      )
      .then((res) => res.rows[0]);

    return res.json({ review: result });
  } catch (err) {
    console.error("Ошибка при проверке отзыва:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// отправить заявку в друзья
app.post("/v1/friends/:friendId", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));
  const friendId = parseInt(req.params.friendId);

  if (!userId || !friendId || isNaN(userId) || isNaN(friendId)) {
    return res.status(400).send("Некорректный userId или friendId");
  }

  if (userId === friendId) {
    return res.status(400).send("Нельзя добавить себя в друзья");
  }

  try {
    // Проверка на существующую дружбу
    const existing = await postgresql.query(
      `SELECT status FROM friends WHERE userid = $1 AND friendid = $2`,
      [userId, friendId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).send("Заявка уже отправлена или вы уже друзья");
    }

    // Проверка на обратную заявку (friend → user)
    const reverse = await postgresql.query(
      `SELECT status FROM friends WHERE userid = $1 AND friendid = $2`,
      [friendId, userId]
    );

    if (reverse.rows[0]?.status === "pending") {
      // Автоапрув: обновляем существующую заявку и вставляем обратную
      await postgresql.query("BEGIN");
      await postgresql.query(
        `UPDATE friends SET status = 'accepted' WHERE userid = $1 AND friendid = $2`,
        [friendId, userId]
      );
      await postgresql.query(
        `INSERT INTO friends (userid, friendid, status) VALUES ($1, $2, 'accepted')`,
        [userId, friendId]
      );
      await postgresql.query("COMMIT");
      sendToRabbitExchange("notifications_events", "notifications.created", {
        userId: friendId,
        uuid: uuidv4(),
        text: `Ваш список друзей пополнился!`,
      });
      sendToRabbitExchange("notifications_events", "notifications.created", {
        userId,
        uuid: uuidv4(),
        text: `Ваш список друзей пополнился!`,
      });
      return res.status(201).send("Заявка подтверждена. Вы теперь друзья!");
    }

    // Обычная новая заявка
    await postgresql.query(
      `INSERT INTO friends (userid, friendid, status) VALUES ($1, $2, 'pending')`,
      [userId, friendId]
    );

    sendToRabbitExchange("notifications_events", "notifications.created", {
      userId: friendId,
      uuid: uuidv4(),
      text: `Вы получили заявку на добавление в друзья`,
    });

    return res.status(201).send("Заявка в друзья отправлена");
  } catch (err) {
    await postgresql.query("ROLLBACK").catch(() => {});
    console.error("Ошибка при отправке заявки:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// просмотреть полученные заявки в друзья
app.get("/v1/friends/requests", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));

  if (!userId || isNaN(userId)) {
    return res.status(400).send("Некорректный X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `SELECT userid AS from_user
       FROM friends
       WHERE friendid = $1 AND status = 'pending'`,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении входящих заявок:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// принять заявку в друзья
app.post("/v1/friends/approve/:friendId", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));
  const friendId = parseInt(req.params.friendId);

  if (!userId || !friendId || isNaN(userId) || isNaN(friendId)) {
    return res.status(400).send("Некорректный userId или friendId");
  }

  try {
    const existing = await postgresql.query(
      `SELECT * FROM friends
       WHERE userid = $1 AND friendid = $2 AND status = 'pending'`,
      [friendId, userId]
    );

    if (existing.rowCount === 0) {
      return res.status(404).send("Заявка не найдена");
    }

    await postgresql.query("BEGIN");
    await postgresql.query(
      `UPDATE friends SET status = 'accepted' WHERE userid = $1 AND friendid = $2`,
      [friendId, userId]
    );
    await postgresql.query(
      `INSERT INTO friends (userid, friendid, status) VALUES ($1, $2, 'accepted')`,
      [userId, friendId]
    );
    await postgresql.query("COMMIT");

    sendToRabbitExchange("notifications_events", "notifications.created", {
      userId,
      uuid: uuidv4(),
      text: `Ваш список друзей пополнился!`,
    });
    sendToRabbitExchange("notifications_events", "notifications.created", {
      userId: friendId,
      uuid: uuidv4(),
      text: `Ваш список друзей пополнился!`,
    });

    return res.status(200).send("Заявка принята. Вы теперь друзья!");
  } catch (err) {
    await postgresql.query("ROLLBACK").catch(() => {});
    console.error("Ошибка при подтверждении заявки:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// удалить из друзей или отклонить заявку
app.delete("/v1/friends/:friendId", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));
  const friendId = parseInt(req.params.friendId);

  if (!userId || !friendId || isNaN(userId) || isNaN(friendId)) {
    return res.status(400).send("Некорректный userId или friendId");
  }

  try {
    await postgresql.query("BEGIN");

    // Удаляем обе стороны (если есть)
    await postgresql.query(
      `DELETE FROM friends WHERE 
       (userid = $1 AND friendid = $2) OR 
       (userid = $2 AND friendid = $1)`,
      [userId, friendId]
    );

    await postgresql.query("COMMIT");
    return res.status(200).send("Связь удалена (или заявка отклонена)");
  } catch (err) {
    await postgresql.query("ROLLBACK").catch(() => {});
    console.error("Ошибка при удалении заявки или друга:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// список друзей
app.get("/v1/friends", async (req, res) => {
  const userId = parseInt(req.header("X-User-Id"));

  if (!userId || isNaN(userId)) {
    return res.status(400).send("Некорректный X-User-Id");
  }

  try {
    const result = await postgresql.query(
      `SELECT friendid FROM friends
       WHERE userid = $1 AND status = 'accepted'
       ORDER BY friendid`,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении друзей:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/friends/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);

  if (!userId || isNaN(userId)) {
    return res.status(400).send("Некорректный userId");
  }

  try {
    const result = await postgresql.query(
      `SELECT friendid
       FROM friends
       WHERE userid = $1 AND status = 'accepted'
       ORDER BY friendid`,
      [userId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении друзей пользователя:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Social service running on port ${APP_PORT}`)
);
