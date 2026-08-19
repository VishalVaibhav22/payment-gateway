const express = require("express");

const paymentIntentController = require("../controllers/payment-intent.controller");
const authMiddleware = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");

const { createPaymentIntentSchema } = require("../validators/payment-intent.validator");

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  requireRole("MERCHANT"),
  validate(createPaymentIntentSchema),
  paymentIntentController.createPaymentIntent,
);

router.get(
  "/:id",
  authMiddleware,
  paymentIntentController.getPaymentIntent,
);

router.post(
  "/:id/process",
  authMiddleware,
  paymentIntentController.processPaymentIntent,
);

module.exports = router;