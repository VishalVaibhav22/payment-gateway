const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/prisma");
const redisClient = require("../src/config/redis");

describe("Payment idempotency", () => {
  let merchantAgent;
  let payerAgent;

  let merchantId;
  let payerId;

  beforeAll(async () => {
    await redisClient.connect();

    merchantAgent = request.agent(app);
    payerAgent = request.agent(app);

    // Create a fresh merchant
    const merchantResponse = await merchantAgent
      .post("/api/auth/register")
      .send({
        name: "Idempotency Merchant",
        email: `merchant-idempotency-${Date.now()}@example.com`,
        password: "password123",
        role: "MERCHANT",
        businessName: "Idempotency Store",
      });

    expect(merchantResponse.status).toBe(201);

    merchantId = merchantResponse.body.user.id;

    // Create a fresh payer
    const payerResponse = await payerAgent
      .post("/api/auth/register")
      .send({
        name: "Idempotency Payer",
        email: `payer-idempotency-${Date.now()}@example.com`,
        password: "password123",
        role: "PAYER",
      });

    expect(payerResponse.status).toBe(201);

    payerId = payerResponse.body.user.id;

    // Give payer ₹1000
    await prisma.wallet.update({
      where: {
        userId: payerId,
      },
      data: {
        balance: 100000,
      },
    });

    // Start merchant with ₹0
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
    if (redisClient.isOpen) {
      await redisClient.quit();
    }

    await prisma.$disconnect();
  });

  test("same idempotency key returns original result without double charging", async () => {
    const idempotencyKey = `success-${Date.now()}`;

    // Create payment intent
    const createResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(createResponse.status).toBe(201);

    const paymentIntent = createResponse.body.paymentIntent;

    // Attach payer
    const attachResponse = await payerAgent.post(
      `/api/payment-intents/${paymentIntent.id}/attach-payer`,
    );

    expect(attachResponse.status).toBe(200);

    // First payment request
    const firstResponse = await payerAgent
      .post(`/api/payment-intents/${paymentIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.paymentIntent.status).toBe("CAPTURED");

    // Second identical request
    const secondResponse = await payerAgent
      .post(`/api/payment-intents/${paymentIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toEqual(firstResponse.body);

    // Check payer wallet
    const payerWallet = await prisma.wallet.findUnique({
      where: {
        userId: payerId,
      },
    });

    // Check merchant wallet
    const merchantWallet = await prisma.wallet.findUnique({
      where: {
        userId: merchantId,
      },
    });

    expect(payerWallet.balance).toBe(50000);
    expect(merchantWallet.balance).toBe(50000);

    // Check ledger entries
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: paymentIntent.id,
      },
    });

    expect(ledgerEntries).toHaveLength(2);

    // Check idempotency record
    const idempotencyRecord = await prisma.idempotencyKey.findUnique({
      where: {
        key: idempotencyKey,
      },
    });

    expect(idempotencyRecord).not.toBeNull();
    expect(idempotencyRecord.status).toBe("COMPLETED");
    expect(idempotencyRecord.responseStatus).toBe(200);

    // Check Redis result
    const redisResult = await redisClient.get(
      `idempotency:${idempotencyKey}`,
    );

    expect(redisResult).not.toBeNull();

    const parsedRedisResult = JSON.parse(redisResult);

    expect(parsedRedisResult.status).toBe("COMPLETED");
    expect(parsedRedisResult.responseStatus).toBe(200);
  });

  test("same key reused for a different payment intent returns 422", async () => {
    const idempotencyKey = `mismatch-${Date.now()}`;

    // Create first payment intent
    const firstCreate = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 10000,
      });

    expect(firstCreate.status).toBe(201);

    const firstIntent = firstCreate.body.paymentIntent;

    // Attach payer to first payment
    const firstAttach = await payerAgent.post(
      `/api/payment-intents/${firstIntent.id}/attach-payer`,
    );

    expect(firstAttach.status).toBe(200);

    // Process first payment
    const firstProcess = await payerAgent
      .post(`/api/payment-intents/${firstIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(firstProcess.status).toBe(200);

    // Create second payment intent
    const secondCreate = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 10000,
      });

    expect(secondCreate.status).toBe(201);

    const secondIntent = secondCreate.body.paymentIntent;

    // Attach payer to second payment
    const secondAttach = await payerAgent.post(
      `/api/payment-intents/${secondIntent.id}/attach-payer`,
    );

    expect(secondAttach.status).toBe(200);

    // Reuse same idempotency key for different payment
    const secondProcess = await payerAgent
      .post(`/api/payment-intents/${secondIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(secondProcess.status).toBe(422);

    expect(secondProcess.body.message).toBe(
      "Idempotency key reused with a different request",
    );

    // Check second payment ledger
    const secondLedgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: secondIntent.id,
      },
    });

    expect(secondLedgerEntries).toHaveLength(0);

    // Check second payment status
    const secondPayment = await prisma.paymentIntent.findUnique({
      where: {
        id: secondIntent.id,
      },
    });

    expect(secondPayment.status).toBe("CREATED");
  });

  test("failed payment with same idempotency key returns the same failure", async () => {
    const idempotencyKey = `failed-${Date.now()}`;

    // Create payment intent larger than available balance
    const createResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 100000,
      });

    expect(createResponse.status).toBe(201);

    const paymentIntent = createResponse.body.paymentIntent;

    // Attach payer
    const attachResponse = await payerAgent.post(
      `/api/payment-intents/${paymentIntent.id}/attach-payer`,
    );

    expect(attachResponse.status).toBe(200);

    // First failed request
    const firstResponse = await payerAgent
      .post(`/api/payment-intents/${paymentIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(firstResponse.status).toBe(409);
    expect(firstResponse.body.paymentIntent.status).toBe("FAILED");

    // Second identical failed request
    const secondResponse = await payerAgent
      .post(`/api/payment-intents/${paymentIntent.id}/process`)
      .set("Idempotency-Key", idempotencyKey);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body).toEqual(firstResponse.body);

    // Check that no ledger entries were created
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: paymentIntent.id,
      },
    });

    expect(ledgerEntries).toHaveLength(0);
  });

  test("missing Idempotency-Key returns 400", async () => {
    // Create payment intent
    const createResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 10000,
      });

    expect(createResponse.status).toBe(201);

    const paymentIntent = createResponse.body.paymentIntent;

    // Attach payer
    const attachResponse = await payerAgent.post(
      `/api/payment-intents/${paymentIntent.id}/attach-payer`,
    );

    expect(attachResponse.status).toBe(200);

    // Process without idempotency key
    const response = await payerAgent.post(
      `/api/payment-intents/${paymentIntent.id}/process`,
    );

    expect(response.status).toBe(400);

    expect(response.body.message).toBe(
      "Idempotency-Key header is required",
    );
  });
});