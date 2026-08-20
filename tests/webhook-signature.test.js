const crypto = require("crypto");

const {
  generateWebhookSignature,
} = require("../src/utils/webhook-signature");

describe("Webhook signature", () => {
  test("generates the expected HMAC-SHA256 signature", () => {
    const payload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50000,
      status: "CAPTURED",
    });

    const secret = "test-webhook-secret";

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload, "utf8")
      .digest("hex");

    const actualSignature = generateWebhookSignature(
      payload,
      secret,
    );

    expect(actualSignature).toBe(expectedSignature);
  });

  test("same payload and same secret generate the same signature", () => {
    const payload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50000,
      status: "CAPTURED",
    });

    const secret = "test-webhook-secret";

    const firstSignature = generateWebhookSignature(
      payload,
      secret,
    );

    const secondSignature = generateWebhookSignature(
      payload,
      secret,
    );

    expect(firstSignature).toBe(secondSignature);
  });

  test("changing the payload changes the signature", () => {
    const originalPayload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50000,
      status: "CAPTURED",
    });

    const modifiedPayload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50001,
      status: "CAPTURED",
    });

    const secret = "test-webhook-secret";

    const originalSignature = generateWebhookSignature(
      originalPayload,
      secret,
    );

    const modifiedSignature = generateWebhookSignature(
      modifiedPayload,
      secret,
    );

    expect(modifiedSignature).not.toBe(originalSignature);
  });

  test("changing the secret changes the signature", () => {
    const payload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50000,
      status: "CAPTURED",
    });

    const firstSignature = generateWebhookSignature(
      payload,
      "secret-one",
    );

    const secondSignature = generateWebhookSignature(
      payload,
      "secret-two",
    );

    expect(secondSignature).not.toBe(firstSignature);
  });

  test("signature is a hexadecimal SHA-256 digest", () => {
    const payload = JSON.stringify({
      paymentIntentId: "payment-123",
      amountPaise: 50000,
      status: "CAPTURED",
    });

    const secret = "test-webhook-secret";

    const signature = generateWebhookSignature(
      payload,
      secret,
    );

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });
});