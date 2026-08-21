const http = require("http");
const { io: createClient } = require("socket.io-client");

const app = require("../src/app");
const {
  initializeSocket,
  getSocketIO,
} = require("../src/config/socket");

describe("Socket.io payment updates", () => {
  let server;
  let port;
  let clientA;
  let clientB;

  beforeAll((done) => {
    server = http.createServer(app);

    initializeSocket(server);

    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach(() => {
    if (clientA) {
      clientA.close();
      clientA = null;
    }

    if (clientB) {
      clientB.close();
      clientB = null;
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
  });

  test("only clients in the payment room receive the payment update", async () => {
    const paymentIntentA = "payment-A";
    const paymentIntentB = "payment-B";

    clientA = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    clientB = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    await Promise.all([
      new Promise((resolve, reject) => {
        clientA.once("connect", resolve);

        clientA.once("connect_error", reject);
      }),
      new Promise((resolve, reject) => {
        clientB.once("connect", resolve);

        clientB.once("connect_error", reject);
      }),
    ]);

    clientA.emit("join-payment", paymentIntentA);
    clientB.emit("join-payment", paymentIntentB);

    await Promise.all([
      new Promise((resolve, reject) => {
        clientA.once("PAYMENT_ROOM_JOINED", (data) => {
          try {
            expect(data.paymentIntentId).toBe(paymentIntentA);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }),
      new Promise((resolve, reject) => {
        clientB.once("PAYMENT_ROOM_JOINED", (data) => {
          try {
            expect(data.paymentIntentId).toBe(paymentIntentB);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }),
    ]);

    const clientAUpdates = [];
    const clientBUpdates = [];

    clientA.on("PAYMENT_UPDATE", (data) => {
      clientAUpdates.push(data);
    });

    clientB.on("PAYMENT_UPDATE", (data) => {
      clientBUpdates.push(data);
    });

    const io = getSocketIO();

    io.to(`payment:${paymentIntentA}`).emit("PAYMENT_UPDATE", {
      paymentIntentId: paymentIntentA,
      status: "CAPTURED",
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect(clientAUpdates).toHaveLength(1);

    expect(clientAUpdates[0]).toEqual({
      paymentIntentId: paymentIntentA,
      status: "CAPTURED",
    });

    expect(clientBUpdates).toHaveLength(0);
  });

  test("client receives payment update for the payment it joined", async () => {
    const paymentIntentId = "payment-123";

    clientA = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      clientA.once("connect", resolve);

      clientA.once("connect_error", reject);
    });

    clientA.emit("join-payment", paymentIntentId);

    await new Promise((resolve, reject) => {
      clientA.once("PAYMENT_ROOM_JOINED", (data) => {
        try {
          expect(data.paymentIntentId).toBe(paymentIntentId);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const receivedUpdate = new Promise((resolve, reject) => {
      clientA.once("PAYMENT_UPDATE", (data) => {
        try {
          expect(data).toEqual({
            paymentIntentId,
            status: "CAPTURED",
          });

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const io = getSocketIO();

    io.to(`payment:${paymentIntentId}`).emit("PAYMENT_UPDATE", {
      paymentIntentId,
      status: "CAPTURED",
    });

    await receivedUpdate;
  });

  test("client does not receive an update for a payment room it did not join", async () => {
    const joinedPaymentIntentId = "payment-joined";
    const differentPaymentIntentId = "payment-different";

    clientA = createClient(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      clientA.once("connect", resolve);

      clientA.once("connect_error", reject);
    });

    clientA.emit("join-payment", joinedPaymentIntentId);

    await new Promise((resolve, reject) => {
      clientA.once("PAYMENT_ROOM_JOINED", (data) => {
        try {
          expect(data.paymentIntentId).toBe(joinedPaymentIntentId);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    let received = false;

    clientA.once("PAYMENT_UPDATE", () => {
      received = true;
    });

    const io = getSocketIO();

    io.to(`payment:${differentPaymentIntentId}`).emit(
      "PAYMENT_UPDATE",
      {
        paymentIntentId: differentPaymentIntentId,
        status: "CAPTURED",
      },
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });

    expect(received).toBe(false);
  });
});