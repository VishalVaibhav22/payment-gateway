const request = require("supertest");

const app = require("../src/app");
const prisma = require("../src/config/prisma");

describe("Payment concurrency and ledger", () => {
  let merchantAgent;
  let payerAgent;

  let merchantId;
  let payerId;

  beforeAll(async () => {
    merchantAgent = request.agent(app);
    payerAgent = request.agent(app);

    /*
     * Create a fresh merchant
     */
    const merchantResponse = await merchantAgent
      .post("/api/auth/register")
      .send({
        name: "Concurrency Merchant",
        email: `merchant-${Date.now()}@example.com`,
        password: "password123",
        role: "MERCHANT",
        businessName: "Concurrency Store",
      });

    expect(merchantResponse.status).toBe(201);

    merchantId = merchantResponse.body.user.id;

    /*
     * Create a fresh payer
     */
    const payerResponse = await payerAgent
      .post("/api/auth/register")
      .send({
        name: "Concurrency Payer",
        email: `payer-${Date.now()}@example.com`,
        password: "password123",
        role: "PAYER",
      });

    expect(payerResponse.status).toBe(201);

    payerId = payerResponse.body.user.id;

    /*
     * Give payer exactly ₹500
     */
    await prisma.wallet.update({
      where: {
        userId: payerId,
      },
      data: {
        balance: 50000,
      },
    });

    /*
     * Start merchant with ₹0
     */
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

  test("handles concurrent payments and maintains ledger consistency", async () => {
    /*
     * ---------------------------------------------------------
     * 1. Create PaymentIntent A
     * ---------------------------------------------------------
     */
    const intentAResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(intentAResponse.status).toBe(201);

    const intentA = intentAResponse.body.paymentIntent;

    expect(intentA.status).toBe("CREATED");
    expect(intentA.payerId).toBeNull();
    expect(intentA.amountPaise).toBe(50000);
    expect(intentA.merchantId).toBe(merchantId);

    /*
     * ---------------------------------------------------------
     * 2. Create PaymentIntent B
     * ---------------------------------------------------------
     */
    const intentBResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(intentBResponse.status).toBe(201);

    const intentB = intentBResponse.body.paymentIntent;

    expect(intentB.status).toBe("CREATED");
    expect(intentB.payerId).toBeNull();
    expect(intentB.amountPaise).toBe(50000);
    expect(intentB.merchantId).toBe(merchantId);

    /*
     * ---------------------------------------------------------
     * 3. Attach the same payer to both intents
     * ---------------------------------------------------------
     */
    const attachAResponse = await payerAgent.post(
      `/api/payment-intents/${intentA.id}/attach-payer`,
    );

    expect(attachAResponse.status).toBe(200);
    expect(attachAResponse.body.paymentIntent.payerId).toBe(payerId);

    const attachBResponse = await payerAgent.post(
      `/api/payment-intents/${intentB.id}/attach-payer`,
    );

    expect(attachBResponse.status).toBe(200);
    expect(attachBResponse.body.paymentIntent.payerId).toBe(payerId);

    /*
     * ---------------------------------------------------------
     * 4. Send both payment requests concurrently
     * ---------------------------------------------------------
     */
    const [resultA, resultB] = await Promise.all([
      payerAgent.post(`/api/payment-intents/${intentA.id}/process`),
      payerAgent.post(`/api/payment-intents/${intentB.id}/process`),
    ]);

    /*
     * ---------------------------------------------------------
     * 5. Exactly one payment succeeds
     * ---------------------------------------------------------
     */
    const results = [resultA, resultB];

    const successfulResults = results.filter(
      (result) => result.status === 200,
    );

    const failedResults = results.filter(
      (result) => result.status === 409,
    );

    expect(successfulResults).toHaveLength(1);
    expect(failedResults).toHaveLength(1);

    /*
     * ---------------------------------------------------------
     * 6. Verify payment states
     * ---------------------------------------------------------
     */
    const statuses = results.map(
      (result) => result.body.paymentIntent.status,
    );

    expect(statuses).toEqual(
      expect.arrayContaining(["CAPTURED", "FAILED"]),
    );

    /*
     * ---------------------------------------------------------
     * 7. Check final payer wallet
     *
     * Payer started with ₹500.
     * Only one ₹500 payment can succeed.
     * Therefore final balance must be ₹0
     * ---------------------------------------------------------
     */
    const payerWallet = await prisma.wallet.findUnique({
      where: {
        userId: payerId,
      },
    });

    expect(payerWallet).not.toBeNull();
    expect(payerWallet.balance).toBe(0);

    /*
     * ---------------------------------------------------------
     * 8. Check final merchant wallet
     *
     * Merchant should receive exactly ₹500
     * ---------------------------------------------------------
     */
    const merchantWallet = await prisma.wallet.findUnique({
      where: {
        userId: merchantId,
      },
    });

    expect(merchantWallet).not.toBeNull();
    expect(merchantWallet.balance).toBe(50000);

    /*
     * ---------------------------------------------------------
     * 9. Determine which payment succeeded/failed
     * ---------------------------------------------------------
     */
    const successfulPaymentResult = results.find(
      (result) => result.body.paymentIntent.status === "CAPTURED",
    );

    const failedPaymentResult = results.find(
      (result) => result.body.paymentIntent.status === "FAILED",
    );

    expect(successfulPaymentResult).toBeDefined();
    expect(failedPaymentResult).toBeDefined();

    const successfulPaymentId =
      successfulPaymentResult.body.paymentIntent.id;

    const failedPaymentId =
      failedPaymentResult.body.paymentIntent.id;

    /*
     * ---------------------------------------------------------
     * 10. Successful payment must have exactly 2 ledger rows
     * ---------------------------------------------------------
     */
    const successfulLedgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: successfulPaymentId,
      },
      orderBy: {
        id: "asc",
      },
    });

    expect(successfulLedgerEntries).toHaveLength(2);

    /*
     * ---------------------------------------------------------
     * 11. Verify the two ledger entries
     * ---------------------------------------------------------
     */
    const debitEntry = successfulLedgerEntries.find(
      (entry) => entry.type === "DEBIT",
    );

    const creditEntry = successfulLedgerEntries.find(
      (entry) => entry.type === "CREDIT",
    );

    expect(debitEntry).toBeDefined();
    expect(creditEntry).toBeDefined();

    /*
     * Payer must be debited
     */
    expect(debitEntry.walletId).toBe(payerWallet.id);
    expect(debitEntry.amountPaise).toBe(50000);
    expect(debitEntry.reason).toBe("PAYMENT");
    expect(debitEntry.paymentIntentId).toBe(successfulPaymentId);

    /*
     * Merchant must be credited
     */
    expect(creditEntry.walletId).toBe(merchantWallet.id);
    expect(creditEntry.amountPaise).toBe(50000);
    expect(creditEntry.reason).toBe("PAYMENT");
    expect(creditEntry.paymentIntentId).toBe(successfulPaymentId);

    /*
     * ---------------------------------------------------------
     * 12. Ledger must balance
     * ---------------------------------------------------------
     */
    const totalDebit = successfulLedgerEntries
      .filter((entry) => entry.type === "DEBIT")
      .reduce((sum, entry) => sum + entry.amountPaise, 0);

    const totalCredit = successfulLedgerEntries
      .filter((entry) => entry.type === "CREDIT")
      .reduce((sum, entry) => sum + entry.amountPaise, 0);

    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(50000);

    /*
     * ---------------------------------------------------------
     * 13. Failed payment must have NO ledger entries
     * ---------------------------------------------------------
     */
    const failedLedgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: failedPaymentId,
      },
    });

    expect(failedLedgerEntries).toHaveLength(0);

    /*
     * ---------------------------------------------------------
     * 14. Verify there are exactly 2 ledger rows created
     * across these two concurrent payment attempts
     * ---------------------------------------------------------
     */
    const allTestLedgerEntries = await prisma.ledgerEntry.findMany({
      where: {
        paymentIntentId: {
          in: [intentA.id, intentB.id],
        },
      },
    });

    expect(allTestLedgerEntries).toHaveLength(2);
  });
});