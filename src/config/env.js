require("dotenv").config();

const port = parseInt(process.env.PORT, 10) || 3000;
const nodeEnv = process.env.NODE_ENV || "development";
const jwtSecret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const config = {
  port,
  nodeEnv,
  jwtSecret,
  databaseUrl,
};

module.exports = config;
