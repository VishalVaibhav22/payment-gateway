const paymentIntentService = require("../services/payment-intent.service");

async function createPaymentIntent(req, res, next) {
  try {
    const { amountPaise } = req.body;

    const paymentIntent = await paymentIntentService.createPaymentIntent({
      merchantId: req.user.id,
      amountPaise,
    });

    return res.status(201).json({
      message: "Payment intent created successfully",
      paymentIntent,
    });
  } catch (error) {
    next(error);
  }
}

async function getPaymentIntent(req, res, next) {
  try {
    const paymentIntent = await paymentIntentService.getPaymentIntent({
      paymentIntentId: req.params.id,
      userId: req.user.id,
    });

    return res.status(200).json({
      paymentIntent,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
};