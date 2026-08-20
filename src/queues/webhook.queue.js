const paymentQueue = require("./payment.queue");

async function addWebhookDeliveryJob({ webhookEventId }) {
  const job = await paymentQueue.add(
    "webhook-delivery",
    {
      webhookEventId,
    },
    {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  return job;
}

module.exports = {
  addWebhookDeliveryJob,
};