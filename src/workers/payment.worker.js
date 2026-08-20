const { Worker } = require("bullmq");

const prisma = require("../config/prisma");
const config = require("../config/env");

const connection = {
  url: config.redisUrl,
};

const paymentWorker = new Worker(
  "payment-events",
  async (job) => {
    const { webhookEventId } = job.data;

    console.log("Processing webhook event:", webhookEventId);

    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: {
        id: webhookEventId,
      },
      include: {
        paymentIntent: {
          include: {
            merchant: {
              include: {
                merchantProfile: true,
              },
            },
          },
        },
      },
    });

    if (!webhookEvent) {
      throw new Error("Webhook event not found");
    }

    if (webhookEvent.status === "DELIVERED") {
      return {
        processed: true,
        skipped: true,
      };
    }

    const merchantProfile =
      webhookEvent.paymentIntent.merchant.merchantProfile;

    if (!merchantProfile) {
      throw new Error("Merchant profile not found");
    }

    if (!merchantProfile.webhookUrl) {
      throw new Error("Merchant webhook URL not configured");
    }

    await prisma.webhookEvent.update({
      where: {
        id: webhookEvent.id,
      },
      data: {
        attempts: {
          increment: 1,
        },
        lastAttemptAt: new Date(),
      },
    });

    const response = await fetch(merchantProfile.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookEvent.payload),
    });

    if (!response.ok) {
      await prisma.webhookEvent.update({
        where: {
          id: webhookEvent.id,
        },
        data: {
          status: "FAILED",
        },
      });

      throw new Error(
        `Webhook delivery failed with status ${response.status}`,
      );
    }

    await prisma.webhookEvent.update({
      where: {
        id: webhookEvent.id,
      },
      data: {
        status: "DELIVERED",
      },
    });

    return {
      processed: true,
      skipped: false,
    };
  },
  {
    connection,
  },
);

paymentWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

paymentWorker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed`, error);
});

module.exports = paymentWorker;