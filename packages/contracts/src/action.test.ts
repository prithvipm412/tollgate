import { describe, expect, it } from "vitest";
import { PaymentActionRequestSchema } from "./action.js";

const base = {
  action_id: "7f100ad7-e421-42f1-9fc8-5761b6701b07",
  amount: { currency: "USD" as const, value: "10.00" },
  reason: "test",
};
const counterparty = { type: "email" as const, value: "a@b.com" };

describe("PaymentActionRequestSchema counterparty requirement", () => {
  it("requires counterparty for payout, refund, and invoice_send", () => {
    for (const kind of ["payout", "refund", "invoice_send"] as const) {
      expect(() => PaymentActionRequestSchema.parse({ ...base, kind })).toThrow();
      expect(PaymentActionRequestSchema.parse({ ...base, kind, counterparty }).kind).toBe(kind);
    }
  });

  it("allows order_create with or without a counterparty", () => {
    expect(PaymentActionRequestSchema.parse({ ...base, kind: "order_create" }).kind).toBe("order_create");
    expect(PaymentActionRequestSchema.parse({ ...base, kind: "order_create", counterparty }).kind).toBe("order_create");
  });
});
