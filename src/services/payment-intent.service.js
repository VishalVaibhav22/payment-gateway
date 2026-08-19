const prisma = require("../config/prisma");

const allowedTransitions = {
  CREATED: ["PROCESSING"],
  PROCESSING: ["CAPTURED", "FAILED"],
  CAPTURED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
};

function transitionPaymentIntent(currentStatus, newStatus) {
  const allowedNextStates = allowedTransitions[currentStatus] || [];

  if (!allowedNextStates.includes(newStatus)) {
    const error = new Error(
      `Invalid payment state transition: ${currentStatus} -> ${newStatus}`,
    );
    error.statusCode = 409;
    throw error;
  }

  return newStatus;
}

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

async function processPaymentIntent({ paymentIntentId, userId }) {
  const paymentIntent = await getPaymentIntent({
    paymentIntentId,
    userId,
  });

  const newStatus = transitionPaymentIntent(
    paymentIntent.status,
    "PROCESSING",
  );

  const updatedPaymentIntent = await prisma.paymentIntent.update({
    where: {
      id: paymentIntentId,
    },
    data: {
      status: newStatus,
    },
  });

  return updatedPaymentIntent;
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
  processPaymentIntent,
};