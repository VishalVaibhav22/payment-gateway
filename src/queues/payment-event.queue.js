const paymentQueue = require("./payment.queue");

async function addPaymentCapturedJob({
  paymentIntentId,
  merchantId,
}) {
  const job = await paymentQueue.add("payment-captured", {
    paymentIntentId,
    merchantId,
  });

  return job;
}

module.exports = {
  addPaymentCapturedJob,
};