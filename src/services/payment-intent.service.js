const prisma = require("../config/prisma");

async function createPaymentIntent({ merchantId, amountPaise }) {
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      merchantId,
      payerId: null,
      amountPaise,
    },
  });

  return paymentIntent;
}

async function getPaymentIntent({ paymentIntentId, userId }) {
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: {
      id: paymentIntentId,
    },
  });

  if (!paymentIntent) {
    const error = new Error("Payment intent not found");
    error.statusCode = 404;
    throw error;
  }

  const isMerchantOwner = paymentIntent.merchantId === userId;
  const isPayerOwner = paymentIntent.payerId === userId;

  if (!isMerchantOwner && !isPayerOwner) {
    const error = new Error(
      "You do not have permission to access this payment intent",
    );
    error.statusCode = 403;
    throw error;
  }

  return paymentIntent;
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
};