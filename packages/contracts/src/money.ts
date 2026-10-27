import { z } from "zod";

/** Add a currency here to support it everywhere Money is used. */
export const CURRENCIES = ["USD"] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * A decimal-string amount. Never parse `value` with parseFloat for arithmetic —
 * use moneyToCents/centsToMoney so all math happens in integer cents.
 */
export const MoneySchema = z.object({
  currency: CurrencySchema,
  value: z.string().regex(/^\d+\.\d{2}$/, "must be a non-negative decimal with exactly 2 decimal places, e.g. '12.50'"),
});
export type Money = z.infer<typeof MoneySchema>;

export function moneyToCents(money: Money): number {
  const [whole, frac] = money.value.split(".");
  return Number(whole) * 100 + Number(frac);
}

export function centsToMoney(cents: number, currency: Currency): Money {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`centsToMoney expects a non-negative integer, got ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return { currency, value: `${whole}.${String(frac).padStart(2, "0")}` };
}
