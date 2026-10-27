import { describe, expect, it } from "vitest";
import { centsToMoney, moneyToCents, MoneySchema } from "./money.js";

describe("Money", () => {
  it("round-trips cents through Money and back", () => {
    for (const cents of [0, 1, 50, 100, 999, 123456]) {
      const money = centsToMoney(cents, "USD");
      expect(MoneySchema.parse(money)).toEqual(money);
      expect(moneyToCents(money)).toBe(cents);
    }
  });

  it("formats sub-dollar amounts with a leading zero", () => {
    expect(centsToMoney(5, "USD").value).toBe("0.05");
  });

  it("rejects malformed decimal strings", () => {
    expect(() => MoneySchema.parse({ currency: "USD", value: "12.5" })).toThrow();
    expect(() => MoneySchema.parse({ currency: "USD", value: "-12.50" })).toThrow();
    expect(() => MoneySchema.parse({ currency: "USD", value: "12.500" })).toThrow();
  });

  it("rejects negative or non-integer cents", () => {
    expect(() => centsToMoney(-1, "USD")).toThrow(RangeError);
    expect(() => centsToMoney(1.5, "USD")).toThrow(RangeError);
  });
});
