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
  const result = await prisma.$transaction(async (tx) => {
    // Fetch the PaymentIntent inside the transaction so the
    // state and ownership checks are part of the same operation
    const paymentIntent = await tx.paymentIntent.findUnique({
      where: {
        id: paymentIntentId,
      },
    });

    if (!paymentIntent) {
      const error = new Error("Payment intent not found");
      error.statusCode = 404;
      throw error;
    }

    // Only the payer attached to this PaymentIntent can process it
    if (paymentIntent.payerId !== userId) {
      const error = new Error(
        "Only the payer assigned to this payment intent can process it",
      );
      error.statusCode = 403;
      throw error;
    }

    // CREATED → PROCESSING
    const processingStatus = transitionPaymentIntent(
      paymentIntent.status,
      "PROCESSING",
    );

    await tx.paymentIntent.update({
      where: {
        id: paymentIntentId,
      },
      data: {
        status: processingStatus,
      },
    });

    /*
     * Lock the payer's wallet row
     *
     * Any other payment transaction trying to lock
     * this same wallet must wait until this transaction
     * commits or rolls back
     */
    const walletRows = await tx.$queryRaw`
      SELECT *
      FROM "Wallet"
      WHERE "userId" = ${paymentIntent.payerId}
      FOR UPDATE
    `;

    const payerWallet = walletRows[0];

    if (!payerWallet) {
      const error = new Error("Payer wallet not found");
      error.statusCode = 404;
      throw error;
    }

    // The balance is read AFTER acquiring the row lock
    if (payerWallet.balance < paymentIntent.amountPaise) {
      // PROCESSING → FAILED
      const failedStatus = transitionPaymentIntent(
        processingStatus,
        "FAILED",
      );

      const failedIntent = await tx.paymentIntent.update({
        where: {
          id: paymentIntentId,
        },
        data: {
          status: failedStatus,
        },
      });

      return {
        paymentIntent: failedIntent,
        succeeded: false,
      };
    }

    // Merchant wallet does not need a balance check for a credit
    const merchantWallet = await tx.wallet.findUnique({
      where: {
        userId: paymentIntent.merchantId,
      },
    });

    if (!merchantWallet) {
      const error = new Error("Merchant wallet not found");
      error.statusCode = 404;
      throw error;
    }

    // Debit payer
    await tx.wallet.update({
      where: {
        id: payerWallet.id,
      },
      data: {
        balance: {
          decrement: paymentIntent.amountPaise,
        },
      },
    });

    // Credit merchant
    await tx.wallet.update({
      where: {
        id: merchantWallet.id,
      },
      data: {
        balance: {
          increment: paymentIntent.amountPaise,
        },
      },
    });

    // PROCESSING → CAPTURED
    const capturedStatus = transitionPaymentIntent(
      processingStatus,
      "CAPTURED",
    );

    const capturedIntent = await tx.paymentIntent.update({
      where: {
        id: paymentIntentId,
      },
      data: {
        status: capturedStatus,
      },
    });

    return {
      paymentIntent: capturedIntent,
      succeeded: true,
    };
  });

  return result;
}

async function attachPayer({ paymentIntentId, payerId }) {
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

  if (paymentIntent.payerId && paymentIntent.payerId !== payerId) {
    const error = new Error(
      "Payment intent is already associated with another payer",
    );
    error.statusCode = 409;
    throw error;
  }

  if (paymentIntent.status !== "CREATED") {
    const error = new Error(
      "Payer can only be attached while payment intent is in CREATED state",
    );
    error.statusCode = 409;
    throw error;
  }

  const updatedPaymentIntent = await prisma.paymentIntent.update({
    where: {
      id: paymentIntentId,
    },
    data: {
      payerId,
    },
  });

  return updatedPaymentIntent;
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
  processPaymentIntent,
  attachPayer,
};