const { z } = require("zod");

const configureWebhookSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .url("Please provide a valid webhook URL"),
});

module.exports = {
  configureWebhookSchema,
};