import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import pg from "pg";
const { Pool } = pg;
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import amqplib from "amqplib";
import prom from "prom-client";

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

// Создаем реестр для наших метрик
const promRegister = new prom.Registry();
prom.collectDefaultMetrics({ promRegister });

// Метрика: общее количество HTTP-запросов
const httpRequestCounter = new prom.Counter({
  name: "http_requests_total",
  help: "Общее количество HTTP запросов",
  labelNames: ["method", "route", "code"],
});

// Метрика: продолжительность обработки запросов
const httpRequestDuration = new prom.Histogram({
  name: "http_request_duration_seconds",
  help: "Продолжительность HTTP запросов в секундах",
  labelNames: ["method", "route", "code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

promRegister.registerMetric(httpRequestCounter);
promRegister.registerMetric(httpRequestDuration);

// Middleware для подсчета метрик
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const durationInSeconds = getDurationInSeconds(start);
    const routePath = req.route?.path || req.path || "unknown";

    httpRequestCounter.inc({
      method: req.method,
      route: routePath,
      code: res.statusCode,
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        route: routePath,
        code: res.statusCode,
      },
      durationInSeconds
    );
  });

  next();
});

function getDurationInSeconds(start) {
  const diff = process.hrtime(start);
  return diff[0] + diff[1] / 1e9;
}

const generateTokens = (
  userId,
  userRoleName,
  userAgent,
  ip,
  newRefreshToken = true
) => {
  const accessToken = jwt.sign({ userId, userRoleName }, ACCESS_JWT_SECRET, {
    expiresIn: "10m",
  });

  let refreshToken;
  if (newRefreshToken) {
    refreshToken = jwt.sign({ userId, userRoleName }, REFRESH_JWT_SECRET, {
      expiresIn: "7d",
    });
    redis.set(
      `refresh:${userId}:${refreshToken}`,
      JSON.stringify({
        userAgent,
        ip,
        createdAt: Date.now(),
      }),
      "EX",
      60 * 60 * 24 * 7
    ); // 7 дней (seconds)
  }
  return { accessToken, refreshToken };
};

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
app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", promRegister.contentType);
  res.end(await promRegister.metrics());
});

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
    sendToRabbitExchange("billing_events", "user.created", {
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
  const { accessToken, refreshToken } = generateTokens(
    user.id,
    user.rolename,
    req.headers["user-agent"],
    req.ip
  );
  sendToRabbitExchange("notifications_events", "notifications.created", {
    userId: user.id,
    uuid: uuidv4(),
    text: `В аккаунт выполнен вход с IP ${req.ip} и устройства "${req.headers["user-agent"]}". Если это были не вы, закройте все сессии на странице аккаунта и смените пароль`,
  });
  return res
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    })
    .json({ accessToken, login: user.nickname, rolename: user.rolename });
});

app.post("/v1/refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.sendStatus(401);
  try {
    const payload = jwt.verify(refreshToken, REFRESH_JWT_SECRET);
    const stored = await redis.get(`refresh:${payload.userId}:${refreshToken}`);
    if (!stored) {
      return res.sendStatus(403);
    }

    const { accessToken } = generateTokens(
      payload.userId,
      payload.userRoleName,
      req.headers["user-agent"],
      req.ip,
      false
    );
    return res.json({ accessToken });
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
      await redis
        .keys(`refresh:*:${refreshToken}`)
        .then((keys) => keys.map((key) => redis.del(key)));
    } catch (err) {
      console.error("Ошибка при удалении refresh-токена из Redis:", err);
    }
  }

  return res
    .clearCookie("refreshToken", {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    })
    .status(200)
    .send("Выход выполнен успешно");
});

app.get("/v1/sessions", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    // Найдём все сессии текущего пользователя
    const keys = await redis.keys(`refresh:${userId}:*`);
    const sessions = await Promise.all(
      keys.map(async (key) => {
        const val = await redis.get(key);
        if (!val) {
          return null;
        }
        const valJSON = JSON.parse(val);
        return {
          createdAt: new Date(valJSON.createdAt),
          userAgent: valJSON.userAgent,
          ip: valJSON.ip,
        };
      })
    ).then((res) => res.filter(Boolean));
    return res.json(sessions);
  } catch (error) {
    console.error("Ошибка при получении сессий:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/logout-all", async (req, res) => {
  const userId = req.header("X-User-Id");

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  try {
    const keys = await redis.keys(`refresh:${userId}:*`);

    if (!keys.length) {
      return res.status(200).send("Активных сессий не найдено");
    }

    await redis.del(...keys); // удалить все ключи разом

    return res.status(200).json({
      message: `Удалено ${keys.length} активных сессий`,
    });
  } catch (error) {
    console.error("Ошибка при удалении всех refresh-токенов:", error);
    return res.status(500).send("Ошибка сервера");
  }
});

app.put("/v1/password", async (req, res) => {
  const userId = req.header("X-User-Id");
  const { oldPassword, newPassword } = req.body;

  if (!userId || isNaN(Number(userId))) {
    return res.status(400).send("Неверный или отсутствующий X-User-Id");
  }

  if (!oldPassword || !newPassword) {
    return res.status(400).send("Нужно указать oldPassword и newPassword");
  }

  try {
    // Получаем текущий хеш из БД
    const oldPasswordHash = await postgresql
      .query(`SELECT password_hash FROM users WHERE id = $1`, [userId])
      .then((res) => res.rows[0]?.password_hash);

    if (!oldPasswordHash) {
      return res
        .status(404)
        .send("Пользователь или хеш старого пароля не найден");
    }

    // Сравниваем старый пароль
    const isMatch = await bcrypt.compare(oldPassword, oldPasswordHash);
    if (!isMatch) {
      return res.status(403).send("Старый пароль неверен");
    }

    // Хешируем и сохраняем новый пароль
    const newHash = await bcrypt.hash(newPassword, 10);
    await postgresql.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, userId]
    );

    sendToRabbitExchange("notifications_events", "notifications.created", {
      userId,
      uuid: uuidv4(),
      text: `На аккаунте успешно обновлён пароль`,
    });

    return res.status(200).send("Пароль успешно изменён");
  } catch (err) {
    console.error("Ошибка при смене пароля:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.get("/v1/admin/users", async (req, res) => {
  const roleName = req.header("X-User-Role-Name");

  if (roleName !== "admin") {
    return res.status(403).send("Доступ разрешён только для администратора");
  }

  try {
    const result = await postgresql.query(
      `SELECT 
         users.id,
         users.email,
         users.nickname,
         users.name,
         users.surname,
         users.birthdate,
         roles.name AS role
       FROM users
       JOIN roles ON users.roleid = roles.id
       ORDER BY users.id`
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении пользователей:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

app.post("/v1/admin/users", async (req, res) => {
  const roleName = req.header("X-User-Role-Name");

  if (roleName !== "admin") {
    return res.status(403).send("Доступ разрешён только для администратора");
  }

  const { email, nickname, password, name, surname, birthdate, role } =
    req.body;

  if (
    !email ||
    !nickname ||
    !password ||
    !name ||
    !surname ||
    !birthdate ||
    !role
  ) {
    return res
      .status(400)
      .send(
        "Необходимо указать все поля: email, nickname, password, name, surname, birthdate, role"
      );
  }

  // Разрешаем создавать только seller и admin
  if (!["seller", "admin"].includes(role.toLowerCase())) {
    return res
      .status(400)
      .send("Можно создать только пользователя с ролью 'seller' или 'admin'");
  }

  try {
    // Проверка уникальности
    const existing = await postgresql.query(
      `SELECT 1 FROM users WHERE email = $1 OR nickname = $2`,
      [email, nickname]
    );
    if (existing.rowCount > 0) {
      return res
        .status(409)
        .send("Пользователь с таким email или nickname уже существует");
    }

    // Получение id роли
    const roleResult = await postgresql.query(
      `SELECT id FROM roles WHERE lower(name) = lower($1)`,
      [role]
    );

    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      return res.status(400).send("Указанная роль не найдена");
    }

    // Хэшируем пароль
    const passwordHash = await bcrypt.hash(password, 10);

    // Создание пользователя
    const insertResult = await postgresql.query(
      `INSERT INTO users (email, nickname, password_hash, name, surname, birthdate, roleid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, nickname, name, surname, birthdate`,
      [email, nickname, passwordHash, name, surname, birthdate, roleId]
    );

    return res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error("Ошибка при создании пользователя:", err);
    return res.status(500).send("Ошибка сервера");
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Users service running on port ${APP_PORT}`)
);
