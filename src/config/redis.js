const { createClient } = require("redis");
const config = require("./env");

const redisClient = createClient({
  url: config.redisUrl,
  RESP: 2,
});

redisClient.on("connect", () => {
  console.log("Redis connected");
});

redisClient.on("error", (error) => {
  console.error("Redis client error", error);
});

module.exports = redisClient;
