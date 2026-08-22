jest.mock("../src/services/redis-idempotency.service", () => ({
  getIdempotencyResult: jest.fn().mockResolvedValue(null),

  setIdempotencyInProgress: jest.fn().mockResolvedValue(true),

  setIdempotencyCompleted: jest.fn().mockResolvedValue(undefined),

  deleteIdempotencyKey: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/queues/webhook.queue", () => ({
  addWebhookDeliveryJob: jest.fn().mockResolvedValue({
    id: "test-webhook-job",
  }),
}));

const http = require("http");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const app = require("../src/app");

const {
  initializeSocket,
  getSocketIO,
} = require("../src/config/socket");

const prisma = require("../src/config/prisma");

describe("Socket.io failed payment update", () => {
  let server;
  let port;
  let client;
  let payerAgent;
  let merchantAgent;

  let payerId;
  let merchantId;
  let paymentIntentId;

  beforeAll(async () => {
    server = http.createServer(app);

    initializeSocket(server);

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });

    merchantAgent = request.agent(app);
    payerAgent = request.agent(app);

    const merchantResponse = await merchantAgent
      .post("/api/auth/register")
      .send({
        name: "Socket Failed Merchant",
        email: `socket-failed-merchant-${Date.now()}@example.com`,
        password: "password123",
        role: "MERCHANT",
        businessName: "Socket Failed Store",
      });

    expect(merchantResponse.status).toBe(201);

    merchantId = merchantResponse.body.user.id;

    const payerResponse = await payerAgent
      .post("/api/auth/register")
      .send({
        name: "Socket Failed Payer",
        email: `socket-failed-payer-${Date.now()}@example.com`,
        password: "password123",
        role: "PAYER",
      });

    expect(payerResponse.status).toBe(201);

    payerId = payerResponse.body.user.id;

    await prisma.wallet.update({
      where: {
        userId: payerId,
      },
      data: {
        balance: 10000,
      },
    });

    await prisma.wallet.update({
      where: {
        userId: merchantId,
      },
      data: {
        balance: 0,
      },
    });
  });

  beforeEach(async () => {
    const createResponse = await merchantAgent
      .post("/api/payment-intents")
      .send({
        amountPaise: 50000,
      });

    expect(createResponse.status).toBe(201);

    paymentIntentId = createResponse.body.paymentIntent.id;

    const attachResponse = await payerAgent.post(
      `/api/payment-intents/${paymentIntentId}/attach-payer`,
    );

    expect(attachResponse.status).toBe(200);

    client = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    client.emit("join-payment", paymentIntentId);

    await new Promise((resolve, reject) => {
      client.once("PAYMENT_ROOM_JOINED", (data) => {
        try {
          expect(data.paymentIntentId).toBe(paymentIntentId);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  afterEach(() => {
    if (client) {
      client.close();
      client = null;
    }
  });

  afterAll(async () => {
    const io = getSocketIO();

    io.close();

    await new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    await prisma.$disconnect();
  });

  test("emits FAILED when payment has insufficient balance", async () => {
    const paymentUpdate = new Promise((resolve, reject) => {
      client.once("PAYMENT_UPDATE", (data) => {
        try {
          expect(data).toEqual({
            paymentIntentId,
            status: "FAILED",
          });

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const paymentResponse = await payerAgent
      .post(`/api/payment-intents/${paymentIntentId}/process`)
      .set("Idempotency-Key", `socket-failed-${Date.now()}`);

    expect(paymentResponse.status).toBe(409);

    expect(paymentResponse.body.paymentIntent.status).toBe("FAILED");

    await paymentUpdate;

    const paymentIntent = await prisma.paymentIntent.findUnique({
      where: {
        id: paymentIntentId,
      },
    });

    expect(paymentIntent.status).toBe("FAILED");

    const payerWallet = await prisma.wallet.findUnique({
      where: {
        userId: payerId,
      },
    });

    const merchantWallet = await prisma.wallet.findUnique({
      where: {
        userId: merchantId,
      },
    });

    expect(payerWallet.balance).toBe(10000);

    expect(merchantWallet.balance).toBe(0);
  });
});