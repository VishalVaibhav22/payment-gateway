const prisma = require("../config/prisma");

const {
  createRequestHash,
  parseStoredResponse,
} = require("./idempotency.service");

const {
  getIdempotencyResult,
  setIdempotencyInProgress,
  setIdempotencyCompleted,
  deleteIdempotencyKey,
} = require("./redis-idempotency.service");

const allowedTransitions = {
  CREATED: ["PROCESSING"],
  PROCESSING: ["CAPTURED", "FAILED"],
  CAPTURED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
};

const { addPaymentCapturedJob } = require("../queues/payment-event.queue");

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

async function processPaymentIntent({
  paymentIntentId,
  userId,
  idempotencyKey,
}) {
  const requestHash = createRequestHash({
    paymentIntentId,
    userId,
  });

  // Check Redis for an existing idempotency result
  const redisResult = await getIdempotencyResult(idempotencyKey);

  if (redisResult) {
    if (redisResult.requestHash !== requestHash) {
      const error = new Error(
        "Idempotency key reused with a different request",
      );
      error.statusCode = 422;
      throw error;
    }

    if (redisResult.status === "COMPLETED") {
      return {
        idempotentReplay: true,
        responseStatus: redisResult.responseStatus,
        responseBody: redisResult.responseBody,
      };
    }

    if (redisResult.status === "IN_PROGRESS") {
      const error = new Error(
        "A payment request with this idempotency key is already in progress",
      );
      error.statusCode = 409;
      throw error;
    }
  }

  // Try to acquire the Redis idempotency lock
  const lockAcquired = await setIdempotencyInProgress(
    idempotencyKey,
    requestHash,
  );

  if (!lockAcquired) {
    const existingRedisResult = await getIdempotencyResult(idempotencyKey);

    if (!existingRedisResult) {
      const error = new Error("Unable to acquire idempotency lock");
      error.statusCode = 409;
      throw error;
    }

    if (existingRedisResult.requestHash !== requestHash) {
      const error = new Error(
        "Idempotency key reused with a different request",
      );
      error.statusCode = 422;
      throw error;
    }

    if (existingRedisResult.status === "COMPLETED") {
      return {
        idempotentReplay: true,
        responseStatus: existingRedisResult.responseStatus,
        responseBody: existingRedisResult.responseBody,
      };
    }

    const error = new Error(
      "A payment request with this idempotency key is already in progress",
    );
    error.statusCode = 409;
    throw error;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Check whether this idempotency key already exists in PostgreSQL
      const existingKey = await tx.idempotencyKey.findUnique({
        where: {
          key: idempotencyKey,
        },
      });

      if (existingKey) {
        // Reject the key if it is reused for a different request
        if (existingKey.requestHash !== requestHash) {
          const error = new Error(
            "Idempotency key reused with a different request",
          );
          error.statusCode = 422;
          throw error;
        }

        // Return the stored result if the request already completed
        if (existingKey.status === "COMPLETED") {
          return {
            idempotentReplay: true,
            responseStatus: existingKey.responseStatus,
            responseBody: parseStoredResponse(existingKey.responseBody),
          };
        }

        // Reject if another request is already processing this key
        const error = new Error(
          "A payment request with this idempotency key is already in progress",
        );
        error.statusCode = 409;
        throw error;
      }

      // Create the durable idempotency record
      const idempotencyRecord = await tx.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          requestHash,
          paymentIntentId,
          status: "IN_PROGRESS",
        },
      });

      // Load the PaymentIntent
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

      // Only the attached payer can process the payment
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

      // Lock the payer wallet
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

      // Check the payer balance after acquiring the row lock
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

        const responseStatus = 409;

        const responseBody = {
          message: "Payment failed",
          paymentIntent: failedIntent,
        };

        // Store the completed failure result
        await tx.idempotencyKey.update({
          where: {
            id: idempotencyRecord.id,
          },
          data: {
            status: "COMPLETED",
            responseStatus,
            responseBody: JSON.stringify(responseBody),
          },
        });

        return {
          idempotentReplay: false,
          responseStatus,
          responseBody,
        };
      }

      // Find the merchant wallet
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

      // Debit the payer wallet
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

      // Credit the merchant wallet
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

      // Create the immutable ledger entries
      await tx.ledgerEntry.createMany({
        data: [
          {
            paymentIntentId: paymentIntent.id,
            walletId: payerWallet.id,
            type: "DEBIT",
            amountPaise: paymentIntent.amountPaise,
            reason: "PAYMENT",
          },
          {
            paymentIntentId: paymentIntent.id,
            walletId: merchantWallet.id,
            type: "CREDIT",
            amountPaise: paymentIntent.amountPaise,
            reason: "PAYMENT",
          },
        ],
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

      const responseStatus = 200;

      const responseBody = {
        message: "Payment captured successfully",
        paymentIntent: capturedIntent,
      };

      // Mark the idempotency request as completed
      await tx.idempotencyKey.update({
        where: {
          id: idempotencyRecord.id,
        },
        data: {
          status: "COMPLETED",
          responseStatus,
          responseBody: JSON.stringify(responseBody),
        },
      });

      return {
        idempotentReplay: false,
        responseStatus,
        responseBody,
      };
    });

    if (
      result.responseStatus === 200 &&
      result.responseBody?.paymentIntent?.status === "CAPTURED"
    ) {
      await addPaymentCapturedJob({
        paymentIntentId: result.responseBody.paymentIntent.id,
        merchantId: result.responseBody.paymentIntent.merchantId,
      });
    }

    // Cache the completed result in Redis
    await setIdempotencyCompleted(
      idempotencyKey,
      requestHash,
      result.responseStatus,
      result.responseBody,
    );

    return result;
  } catch (error) {
    // Remove the temporary Redis lock after an unexpected failure
    await deleteIdempotencyKey(idempotencyKey);

    throw error;
  }
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
  processPaymentIntent,
  attachPayer,
};
