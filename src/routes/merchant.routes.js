const express = require("express");

const merchantController = require("../controllers/merchant.controller");
const authMiddleware = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");

const { configureWebhookSchema } = require("../validators/merchant.validator");

const router = express.Router();

router.post(
  "/webhook-config",
  authMiddleware,
  requireRole("MERCHANT"),
  validate(configureWebhookSchema),
  merchantController.configureWebhook,
);

module.exports = router;
