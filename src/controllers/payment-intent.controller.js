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

async function processPaymentIntent(req, res, next) {
  try {
    const result = await paymentIntentService.processPaymentIntent({
      paymentIntentId: req.params.id,
      userId: req.user.id,
    });

    if (!result.succeeded) {
      return res.status(409).json({
        message: "Payment failed",
        paymentIntent: result.paymentIntent,
      });
    }

    return res.status(200).json({
      message: "Payment captured successfully",
      paymentIntent: result.paymentIntent,
    });
  } catch (error) {
    next(error);
  }
}

async function attachPayer(req, res, next) {
  try {
    const paymentIntent = await paymentIntentService.attachPayer({
      paymentIntentId: req.params.id,
      payerId: req.user.id,
    });

    return res.status(200).json({
      message: "Payer attached successfully",
      paymentIntent,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
  processPaymentIntent,
  attachPayer,
};