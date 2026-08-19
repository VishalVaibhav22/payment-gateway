const { z } = require("zod");

const createPaymentIntentSchema = z.object({
  amountPaise: z.number().int().positive(),
});

module.exports = {
  createPaymentIntentSchema,
};