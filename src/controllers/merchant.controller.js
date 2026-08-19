const merchantService = require("../services/merchant.service");

async function configureWebhook(req, res, next) {
  try {
    const { webhookUrl } = req.body;

    const result = await merchantService.configureWebhook({
      userId: req.user.id,
      webhookUrl,
    });

    return res.status(200).json({
      message: "Webhook configured successfully",
      merchantProfile: result.merchantProfile,
      webhookSecret: result.webhookSecret,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  configureWebhook,
};