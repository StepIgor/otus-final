import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import pg from "pg";
const { Pool } = pg;
import Redis from "ioredis";

const APP_PORT = process.env.APP_PORT;
const ACCESS_JWT_SECRET = process.env.ACCESS_JWT_SECRET;
const REFRESH_JWT_SECRET = process.env.REFRESH_JWT_SECRET;
const PSWD_HASH_ROUNDS = process.env.PSWD_HASH_ROUNDS;

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

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, ACCESS_JWT_SECRET, {
    expiresIn: "15m",
  });
  const refreshToken = jwt.sign({ userId }, REFRESH_JWT_SECRET, {
    expiresIn: "7d",
  });
  redis.set(`refresh:${refreshToken}`, userId, "EX", 60 * 60 * 24 * 7); // 7 дней (seconds)
  return { accessToken, refreshToken };
};

// ENDPOINTS
app.post("/register", async (req, res) => {
  const { email, nickname, password, name, surname, birthdate } = req.body;
  if (!email || !nickname || !password || !name || !surname || !birthdate) {
    return res
      .status(400)
      .send(
        "Не указан один из обязательных реквизитов: email, nickname, password, name, surname, birhdate"
      );
  }
  const existingUser = await postgresql
    .query("SELECT null FROM users WHERE email = $1 or nickname = $2", [
      email,
      nickname,
    ])
    .then((res) => res.rows[0]);
  if (existingUser) {
    return res
      .status(400)
      .send("Пользователь с указанными email или nickname уже зарегистрирован");
  }
  const hashedPswd = await bcrypt.hash(password, Number(PSWD_HASH_ROUNDS));
  try {
    const userRoleId = await postgresql
      .query("SELECT id FROM roles WHERE lower(name) = lower('user')")
      .then((res) => res.rows[0].id);
    const newUser = await postgresql.query(
      "INSERT INTO users (email, nickname, password_hash, name, surname, birthdate, roleid) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [email, nickname, hashedPswd, name, surname, birthdate, userRoleId]
    );
    return res.status(201).json(newUser);
  } catch (error) {
    console.log("Ошибка внесения записи /register", error);
    return res.status(400).send(error.message);
  }
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).send("Не указаны реквизиты: login, password");
  }
  const user = await postgresql
    .query("SELECT * FROM users WHERE email = $1 OR nickname = $1", [login])
    .then((res) => res.rows[0]);
  if (!user) {
    return res.status(401).send("Пользователь не обнаружен");
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).send("Указан неверный пароль");
  }
  const { accessToken, refreshToken } = generateTokens(user.id);
  return res
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      path: "/refresh-token",
    })
    .json({ accessToken });
});

app.post("/refresh-token", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.sendStatus(401);
  try {
    const payload = jwt.verify(refreshToken, REFRESH_JWT_SECRET);
    const stored = await redis.get(`refresh:${refreshToken}`);
    if (!stored || Number(stored) !== Number(payload.userId)) {
      return res.sendStatus(403);
    }

    const { accessToken, refreshToken: newRefresh } = generateTokens(
      payload.userId
    );
    return res
      .cookie("refreshToken", newRefresh, {
        httpOnly: true,
        path: "/refresh-token",
      })
      .json({ accessToken });
  } catch (err) {
    console.log("Ошибка /refresh-token", err);
    return res.sendStatus(403);
  }
});

// SERVICE START
app.listen(APP_PORT, () =>
  console.log(`Users service running on port ${APP_PORT}`)
);
