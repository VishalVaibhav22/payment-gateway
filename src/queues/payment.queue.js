const { Queue } = require("bullmq");
const config = require("../config/env");

const connection = {
  url: config.redisUrl,
};

const paymentQueue = new Queue("payment-events", {
  connection,
});

module.exports = paymentQueue;