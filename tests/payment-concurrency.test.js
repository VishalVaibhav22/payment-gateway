const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/prisma");

describe("Payment concurrency", () => {
  let merchantAgent;
  let payerAgent;

  let merchantId;
  let payerId;

  beforeAll(async () => {
    merchantAgent = request.agent(app);
    payerAgent = request.agent(app);

    // Register a fresh merchant.
    const merchantResponse = await merchantAgent
      .post("/api/auth/register")
      .send({
        name: "Concurrency Merchant",
        email: `merchant-concurrency-${Date.now()}@example.com`,
        password: "password123",
        role: "MERCHANT",
        businessName: "Concurrency Store",
      });

    expect(merchantResponse.status).toBe(201);

    merchantId = merchantResponse.body.user.id;

    // Register a fresh payer.
    const payerResponse = await payerAgent
      .post("/api/auth/register")
      .send({
        name: "Concurrency Payer",
        email: `payer-concurrency-${Date.now()}@example.com`,
        password: "password123",
        role: "PAYER",
      });

    expect(payerResponse.status).toBe(201);

    payerId = payerResponse.body.user.id;

    // Give the payer exactly ₹500.
    await prisma.wallet.update({
      where: {
        userId: payerId,
      },
      data: {
        balance: 50000,
      },
    });

    // Start the merchant with ₹0.
    await prisma.wallet.update({
      where: {
        userId: merchantId,
      },
      data: {
        balance: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("only one of two concurrent ₹500 payments should succeed", async () => {
    // Create PaymentIntent A.
    const intentAResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(intentAResponse.status).toBe(201);

    const intentA = intentAResponse.body.paymentIntent;

    // Create PaymentIntent B.
    const intentBResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(intentBResponse.status).toBe(201);

    const intentB = intentBResponse.body.paymentIntent;

    // Attach the same payer to both PaymentIntents
    const attachAResponse = await payerAgent.post(
      `/api/payment-intents/${intentA.id}/attach-payer`,
    );

    expect(attachAResponse.status).toBe(200);

    const attachBResponse = await payerAgent.post(
      `/api/payment-intents/${intentB.id}/attach-payer`,
    );

    expect(attachBResponse.status).toBe(200);

    /*
     * Send both payment requests concurrently.
     *
     * This is the important part of the concurrency test.
     */
    const [resultA, resultB] = await Promise.all([
      payerAgent.post(`/api/payment-intents/${intentA.id}/process`),
      payerAgent.post(`/api/payment-intents/${intentB.id}/process`),
    ]);

    /*
     * Exactly one payment must succeed
     * and exactly one must fail.
     */
    const paymentStatuses = [
      resultA.body.paymentIntent.status,
      resultB.body.paymentIntent.status,
    ];

    expect(paymentStatuses).toEqual(
      expect.arrayContaining(["CAPTURED", "FAILED"]),
    );

    /*
     * Exactly one HTTP response should be 200.
     */
    const successfulResponses = [resultA.status, resultB.status].filter(
      (status) => status === 200,
    );

    expect(successfulResponses).toHaveLength(1);

    /*
     * Exactly one HTTP response should be 409.
     */
    const failedResponses = [resultA.status, resultB.status].filter(
      (status) => status === 409,
    );

    expect(failedResponses).toHaveLength(1);

    /*
     * The payer had exactly ₹500.
     *
     * Only one ₹500 payment can therefore succeed.
     */
    const payerWallet = await prisma.wallet.findUnique({
      where: {
        userId: payerId,
      },
    });

    expect(payerWallet.balance).toBe(0);

    /*
     * Merchant must receive exactly ₹500,
     * never ₹1000.
     */
    const merchantWallet = await prisma.wallet.findUnique({
      where: {
        userId: merchantId,
      },
    });

    expect(merchantWallet.balance).toBe(50000);
  });
});