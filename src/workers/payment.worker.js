const { Worker } = require("bullmq");
const config = require("../config/env");

const connection = {
  url: config.redisUrl,
};

const paymentWorker = new Worker(
  "payment-events",
  async (job) => {
    console.log("Processing job:", job.name);
    console.log("Webhook event ID:", job.data.webhookEventId);

    return {
      processed: true,
    };
  },
  {
    connection,
  },
);

paymentWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

paymentWorker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed`, error);
});

module.exports = paymentWorker;