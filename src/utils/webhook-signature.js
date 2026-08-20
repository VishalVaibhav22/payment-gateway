const crypto = require("crypto");

function generateWebhookSignature(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

module.exports = {
  generateWebhookSignature,
};