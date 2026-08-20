const { Queue } = require("bullmq");

const prisma = require("../src/config/prisma");
const config = require("../src/config/env");
const paymentWorker = require("../src/workers/payment.worker");

const connection = {
  url: config.redisUrl,
};

const testQueue = new Queue("payment-events", {
  connection,
});

async function waitForWebhookStatus(
  webhookEventId,
  expectedStatus,
  timeoutMs = 10000,
) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const webhookEvent = await prisma.webhookEvent.findUnique({
      where: {
        id: webhookEventId,
      },
    });

    if (webhookEvent?.status === expectedStatus) {
      return webhookEvent;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  const finalEvent = await prisma.webhookEvent.findUnique({
    where: {
      id: webhookEventId,
    },
  });

  throw new Error(
    `Webhook event ${webhookEventId} did not reach ${expectedStatus} within ${timeoutMs}ms, current status: ${finalEvent?.status}`,
  );
}

describe("Webhook retry behavior", () => {
  let merchantId;

  beforeAll(async () => {
    const merchantResponse = await require("supertest")(
      require("../src/app"),
    )
      .post("/api/auth/register")
      .send({
        name: "Webhook Retry Merchant",
        email: `webhook-retry-${Date.now()}@example.com`,
        password: "password123",
        role: "MERCHANT",
        businessName: "Retry Store",
      });

    expect(merchantResponse.status).toBe(201);

    merchantId = merchantResponse.body.user.id;

    await prisma.merchantProfile.update({
      where: {
        userId: merchantId,
      },
      data: {
        webhookUrl: "http://merchant.test/webhook",
        webhookSecret: "test-webhook-secret",
      },
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();

    await prisma.webhookEvent.deleteMany({
      where: {
        paymentIntent: {
          merchantId,
        },
      },
    });

    await prisma.paymentIntent.deleteMany({
      where: {
        merchantId,
      },
    });
  });

  afterAll(async () => {
    await testQueue.obliterate({
      force: true,
    });

    await paymentWorker.close();
    await testQueue.close();
    await prisma.$disconnect();
  });

  test("retries failed webhook delivery and eventually succeeds", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            received: false,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            received: false,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            received: true,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    const paymentIntent = await prisma.paymentIntent.create({
      data: {
        merchantId,
        amountPaise: 50000,
        status: "CAPTURED",
      },
    });

    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        paymentIntentId: paymentIntent.id,
        type: "payment.captured",
        payload: {
          paymentIntentId: paymentIntent.id,
          amountPaise: 50000,
          status: "CAPTURED",
        },
      },
    });

    await testQueue.add(
      "webhook-delivery",
      {
        webhookEventId: webhookEvent.id,
      },
      {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 100,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    const finalEvent = await waitForWebhookStatus(
      webhookEvent.id,
      "DELIVERED",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(finalEvent.status).toBe("DELIVERED");
    expect(finalEvent.attempts).toBe(3);
    expect(finalEvent.lastAttemptAt).not.toBeNull();
  });

  test("marks webhook as FAILED after all retry attempts are exhausted", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            received: false,
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

    const paymentIntent = await prisma.paymentIntent.create({
      data: {
        merchantId,
        amountPaise: 50000,
        status: "CAPTURED",
      },
    });

    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        paymentIntentId: paymentIntent.id,
        type: "payment.captured",
        payload: {
          paymentIntentId: paymentIntent.id,
          amountPaise: 50000,
          status: "CAPTURED",
        },
      },
    });

    await testQueue.add(
      "webhook-delivery",
      {
        webhookEventId: webhookEvent.id,
      },
      {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 100,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    const finalEvent = await waitForWebhookStatus(
      webhookEvent.id,
      "FAILED",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(finalEvent.status).toBe("FAILED");
    expect(finalEvent.attempts).toBe(3);
    expect(finalEvent.lastAttemptAt).not.toBeNull();
  });
});