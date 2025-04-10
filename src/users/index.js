import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import pg from "pg";
const { Pool } = pg;
import Redis from "ioredis";
import cors from "cors";
import amqplib from "amqplib";

const APP_PORT = process.env.APP_PORT;
const ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;
const PSWD_HASH_ROUNDS = process.env.PSWD_HASH_ROUNDS;
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
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

const generateTokens = (userId, userRoleName) => {
  const accessToken = jwt.sign({ userId, userRoleName }, ACCESS_JWT_SECRET, {
    expiresIn: "15m",
  });
  const refreshToken = jwt.sign({ userId, userRoleName }, REFRESH_JWT_SECRET, {
    expiresIn: "7d",
  });
  redis.set(`refresh:${refreshToken}`, userId, "EX", 60 * 60 * 24 * 7); // 7 дней (seconds)
  return { accessToken, refreshToken };
};

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
app.post("/v1/register", async (req, res) => {
  const { email, nickname, password, name, surname, birthdate } = req.body;

  if (!email || !nickname || !password || !name || !surname || !birthdate) {
    return res
      .status(400)
      .send(
        "Не указан один из обязательных реквизитов: email, nickname, password, name, surname, birhdate"
      );
  }

  const client = await postgresql.connect();

  try {
    await client.query("BEGIN");

    const existingUser = await client.query(
      "SELECT null FROM users WHERE email = $1 or nickname = $2",
      [email, nickname]
    );

    if (existingUser.rowCount > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .send(
          "Пользователь с указанными email или nickname уже зарегистрирован"
        );
    }

    const userRoleRes = await client.query(
      "SELECT id FROM roles WHERE lower(name) = lower('user')"
    );

    const userRoleId = userRoleRes.rows[0]?.id;

    if (!userRoleId) {
      await client.query("ROLLBACK");
      return res.status(500).send("Роль 'user' не найдена в базе данных");
    }

    const hashedPswd = await bcrypt.hash(password, Number(PSWD_HASH_ROUNDS));

    const newUserRes = await client.query(
      `INSERT INTO users (email, nickname, password_hash, name, surname, birthdate, roleid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, nickname, name, surname, birthdate`,
      [email, nickname, hashedPswd, name, surname, birthdate, userRoleId]
    );

    const newUser = newUserRes.rows[0];

    await client.query("COMMIT");

    // Публикуем событие только после успешного коммита
    sendToRabbitEchange("billing_events", "user.created", {
      userId: newUser.id,
    });

    return res.status(201).json(newUser);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка регистрации:", error);
    return res.status(500).send("Ошибка при регистрации пользователя");
  } finally {
    client.release();
  }
});

app.post("/v1/login", async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).send("Не указаны реквизиты: login, password");
  }
  const user = await postgresql
    .query(
      'SELECT u.id, u.nickname, r.name "rolename", u.password_hash FROM users u JOIN roles r on r.id = u.roleid WHERE u.email = $1 OR u.nickname = $1',
      [login]
    )
    .then((res) => res.rows[0]);
  if (!user) {
    return res.status(400).send("Пользователь не обнаружен");
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    return res.status(400).send("Указан неверный пароль");
  }
  const { accessToken, refreshToken } = generateTokens(user.id, user.rolename);
  return res
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      path: "/auth/refresh-token",
    })
    .json({ accessToken, login: user.nickname, rolename: user.rolename });
});

app.post("/v1/refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.sendStatus(401);
  try {
    const payload = jwt.verify(refreshToken, REFRESH_JWT_SECRET);
    const stored = await redis.get(`refresh:${refreshToken}`);
    if (!stored || Number(stored) !== Number(payload.userId)) {
      return res.sendStatus(403);
    }

    const { accessToken, refreshToken: newRefresh } = generateTokens(
      payload.userId,
      payload.userRoleName
    );
    return res
      .cookie("refreshToken", newRefresh, {
        httpOnly: true,
        path: "/auth/refresh-token",
      })
      .json({ accessToken });
  } catch (err) {
    return res.status(403).send(err.message);
  }
});

app.get("/v1/validate", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.sendStatus(401);
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, ACCESS_JWT_SECRET);
    return res
      .setHeader("X-User-Id", payload.userId)
      .setHeader("X-User-Role-Name", payload.userRoleName)
      .sendStatus(200);
  } catch (err) {
    res.status(401).send(err.message);
  }
});

app.get("/v1/users/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await postgresql.query(
      `SELECT u.id, u.email, u.nickname, u.name, u.surname, u.birthdate, r.name "rolename"
       FROM users u JOIN roles r ON r.id = u.roleid
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Пользователь не найден");
    }

    const user = result.rows[0];
    return res.json(user);
  } catch (error) {
    console.error("Ошибка при получении пользователя:", error.message);
    return res.status(500).send("Внутренняя ошибка сервера");
  }
});

app.get("/v1/me", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId) {
    return res.status(400).send("Заголовок X-User-Id отсутствует");
  }

  try {
    const result = await postgresql.query(
      `SELECT u.id, u.email, u.nickname, u.name, u.surname, u.birthdate, r.name "rolename"
       FROM users u JOIN roles r ON r.id = u.roleid
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Пользователь не найден");
    }

    const user = result.rows[0];
    return res.json(user);
  } catch (error) {
    console.error("Ошибка при получении текущего пользователя:", error.message);
    return res.status(500).send("Внутренняя ошибка сервера");
  }
});

app.put("/v1/me", async (req, res) => {
  const userId = req.header("X-User-Id");
  const { name, surname, birthdate } = req.body;

  if (!userId) {
    return res.status(400).send("Заголовок X-User-Id обязателен");
  }

  if (!name || !surname || !birthdate) {
    return res
      .status(400)
      .send("Отсутствуют обязательные поля: name, surname, birthdate");
  }

  const client = await postgresql.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE users
       SET name = $1, surname = $2, birthdate = $3
       WHERE id = $4
       RETURNING id, email, nickname, name, surname, birthdate`,
      [name, surname, birthdate, userId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("Пользователь не найден");
    }

    await client.query("COMMIT");

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка при обновлении профиля:", error.message);
    return res.status(500).send("Ошибка при обновлении данных пользователя");
  } finally {
    client.release();
  }
});

app.post("/v1/logout", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    try {
      await redis.del(`refresh:${refreshToken}`);
    } catch (err) {
      console.error("Ошибка при удалении refresh-токена из Redis:", err);
    }
  }

  return res
    .clearCookie("refreshToken", {
      httpOnly: true,
      path: "/auth/refresh-token",
    })
    .status(200)
    .send("Выход выполнен успешно");
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Users service running on port ${APP_PORT}`)
);
