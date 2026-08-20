const crypto = require("crypto");

function createRequestHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function parseStoredResponse(responseBody) {
  if (!responseBody) {
    return null;
  }

  return JSON.parse(responseBody);
}

module.exports = {
  createRequestHash,
  parseStoredResponse,
};