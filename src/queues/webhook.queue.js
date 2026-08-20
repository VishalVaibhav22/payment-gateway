const paymentQueue = require("./payment.queue");

async function addWebhookDeliveryJob({ webhookEventId }) {
  const job = await paymentQueue.add("webhook-delivery", {
    webhookEventId,
  });

  return job;
}

module.exports = {
  addWebhookDeliveryJob,
};