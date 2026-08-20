const redisClient = require("../config/redis");

function getIdempotencyKey(key) {
  return `idempotency:${key}`;
}

async function getIdempotencyResult(key) {
  const redisKey = getIdempotencyKey(key);

  const value = await redisClient.get(redisKey);

  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

async function setIdempotencyInProgress(
  key,
  requestHash,
  ttlSeconds = 30,
) {
  const redisKey = getIdempotencyKey(key);

  const value = JSON.stringify({
    status: "IN_PROGRESS",
    requestHash,
  });

  const result = await redisClient.set(redisKey, value, {
    NX: true,
    EX: ttlSeconds,
  });

  return result === "OK";
}

async function setIdempotencyCompleted(
  key,
  requestHash,
  responseStatus,
  responseBody,
  ttlSeconds = 86400,
) {
  const redisKey = getIdempotencyKey(key);

  const value = JSON.stringify({
    status: "COMPLETED",
    requestHash,
    responseStatus,
    responseBody,
  });

  await redisClient.set(redisKey, value, {
    EX: ttlSeconds,
  });
}

async function deleteIdempotencyKey(key) {
  const redisKey = getIdempotencyKey(key);

  await redisClient.del(redisKey);
}

module.exports = {
  getIdempotencyResult,
  setIdempotencyInProgress,
  setIdempotencyCompleted,
  deleteIdempotencyKey,
};