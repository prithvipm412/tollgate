import nock from "nock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPayPalClient, PayPalError } from "./index.js";
const base = "https://api-m.sandbox.paypal.com";
const input = {
  action_id: "a-test-action",
  amount: { currency: "USD" as const, value: "12.50" },
  recipient: { type: "email" as const, value: "test@example.com" },
};
const oauth = () =>
  nock(base)
    .post("/v1/oauth2/token", "grant_type=client_credentials")
    .basicAuth({ user: "id", pass: "secret" })
    .reply(200, { access_token: "token", expires_in: 120 });
const write = () =>
  nock(base, {
    reqheaders: { authorization: "Bearer token", "paypal-request-id": input.action_id },
  });
const sleep = vi.fn(async (_ms: number) => {});
const client = (now?: () => number) =>
  createPayPalClient({ clientId: "id", clientSecret: "secret", webhookId: "webhook", sleep, now });
beforeEach(() => {
  nock.disableNetConnect();
  sleep.mockClear();
});
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  expect(pending).toEqual([]);
});
describe("PayPal sandbox client", () => {
  it("creates a payout and retrieves the actual item ID", async () => {
    oauth();
    write()
      .post("/v1/payments/payouts", {
        sender_batch_header: { sender_batch_id: input.action_id },
        items: [
          {
            sender_item_id: input.action_id,
            recipient_type: "EMAIL",
            receiver: input.recipient.value,
            amount: input.amount,
          },
        ],
      })
      .reply(201, { batch_header: { payout_batch_id: "batch" } });
    nock(base)
      .get("/v1/payments/payouts/batch")
      .reply(200, { items: [{ payout_item_id: "item", transaction_status: "PENDING" }] });
    expect(await client().createPayout(input)).toEqual({
      payout_item_id: "item",
      status: "PENDING",
    });
  });
  it.each([true, false])("refunds a capture, partial=%s", async (partial) => {
    oauth();
    write()
      .post(
        "/v2/payments/captures/capture/refund",
        partial ? { amount: { currency_code: "USD", value: "12.50" } } : {},
      )
      .reply(201, { id: "refund", status: "COMPLETED" });
    expect(
      await client().refundCapture({
        action_id: input.action_id,
        capture_id: "capture",
        ...(partial ? { amount: input.amount } : {}),
      }),
    ).toEqual({ refund_id: "refund", status: "COMPLETED" });
  });
  it("creates and sends an invoice with the same request ID on both writes", async () => {
    oauth();
    write()
      .post("/v2/invoicing/invoices", {
        detail: { currency_code: "USD", note: "memo" },
        primary_recipients: [{ billing_info: { email_address: input.recipient.value } }],
        items: [
          { name: "Payment", quantity: "1", unit_amount: { currency_code: "USD", value: "12.50" } },
        ],
      })
      .reply(201, { id: "invoice", status: "DRAFT" });
    write().post("/v2/invoicing/invoices/invoice/send", { send_to_recipient: true }).reply(202);
    expect(await client().createAndSendInvoice({ ...input, memo: "memo" })).toEqual({
      invoice_id: "invoice",
      status: "SENT",
    });
  });
  it("creates an order and returns its approval URL", async () => {
    oauth();
    write()
      .post("/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: "12.50" } }],
      })
      .reply(201, {
        id: "order",
        status: "CREATED",
        links: [{ rel: "approve", href: "https://paypal.com/approve" }],
      });
    expect(await client().createOrder(input)).toEqual({
      order_id: "order",
      status: "CREATED",
      approve_url: "https://paypal.com/approve",
    });
  });
  it.each([500, 429])("retries %s with backoff and preserves request ID", async (status) => {
    oauth();
    write()
      .post("/v2/checkout/orders")
      .reply(status)
      .post("/v2/checkout/orders")
      .reply(201, { id: "order", status: "CREATED" });
    await client().createOrder(input);
    expect(sleep).toHaveBeenCalledWith(100);
  });
  it("caps retries with increasing backoff", async () => {
    oauth();
    write().post("/v2/checkout/orders").times(3).reply(503);
    await expect(client().createOrder(input)).rejects.toMatchObject({ status: 503 });
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });
  it.each([400, 401, 403, 422])("never retries %s", async (status) => {
    oauth();
    write().post("/v2/checkout/orders").reply(status);
    await expect(client().createOrder(input)).rejects.toMatchObject({ status });
    expect(sleep).not.toHaveBeenCalled();
  });
  it("caches concurrent OAuth requests and refreshes before expiry", async () => {
    let now = 0;
    const api = client(() => now);
    oauth();
    write().post("/v2/checkout/orders").times(3).reply(201, { id: "order", status: "CREATED" });
    await Promise.all([api.createOrder(input), api.createOrder(input)]);
    now = 89_000;
    await api.createOrder(input);
    now = 91_000;
    oauth();
    write().post("/v2/checkout/orders").reply(201, { id: "order", status: "CREATED" });
    await api.createOrder(input);
  });
  it("does not retry a transport failure", async () => {
    oauth();
    write().post("/v2/checkout/orders").replyWithError("offline");
    await expect(client().createOrder(input)).rejects.toBeInstanceOf(PayPalError);
    expect(sleep).not.toHaveBeenCalled();
  });
  const headers = {
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
    "PAYPAL-CERT-URL": "https://paypal.com/cert",
    "PAYPAL-TRANSMISSION-ID": "transmission",
    "PAYPAL-TRANSMISSION-SIG": "signature",
    "PAYPAL-TRANSMISSION-TIME": "time",
  };
  it.each(["SUCCESS", "FAILURE", "UNKNOWN"])(
    "webhook verification %s",
    async (verification_status) => {
      oauth();
      nock(base)
        .post("/v1/notifications/verify-webhook-signature", {
          auth_algo: "SHA256withRSA",
          cert_url: "https://paypal.com/cert",
          transmission_id: "transmission",
          transmission_sig: "signature",
          transmission_time: "time",
          webhook_id: "webhook",
          webhook_event: { id: "event" },
        })
        .reply(200, { verification_status });
      expect(await client().verifyWebhook({ headers, body: '{"id":"event"}' })).toBe(
        verification_status === "SUCCESS",
      );
    },
  );
  it("returns false on malformed bodies, missing headers, and PayPal failure", async () => {
    const api = client();
    expect(await api.verifyWebhook({ headers, body: "invalid" })).toBe(false);
    expect(await api.verifyWebhook({ headers: {}, body: "{}" })).toBe(false);
    oauth();
    nock(base).post("/v1/notifications/verify-webhook-signature").reply(400);
    expect(await api.verifyWebhook({ headers, body: "{}" })).toBe(false);
  });
});
