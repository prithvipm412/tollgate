import { describe, expect, it } from "vitest";
import { FindingSchema, type EvaluatePolicy, type Money } from "@tollgate/contracts";
import { evaluatePolicy } from "./index.js";

type Input = Parameters<EvaluatePolicy>[0];
const money = (value: string): Money => ({ currency: "USD", value });
function input(): Input {
  return {
    request: { action_id: "7f100ad7-e421-42f1-9fc8-5761b6701b07", kind: "payout", amount: money("10.01"), counterparty: { type: "email", value: "vendor@example.com" }, category: "design", reason: "Invoice payment" },
    policy: { version: 1, kinds_allowed: ["payout", "refund", "invoice_send", "order_create"], limits: {}, approval: { new_counterparty: false }, counterparties: {}, categories: {}, velocity: {} },
    history: { spent_today: 0, spent_week: 0, spent_month: 0, actions_last_hour: 0, known_counterparties: [], amount_stats: { n: 0, mean_cents: 0, stddev_cents: 0 } },
    now: new Date("2026-10-26T12:00:00Z"),
  };
}
const rules: [string, "block" | "hold" | "warn", (i: Input) => void][] = [
  ["KIND_NOT_ALLOWED", "block", i => { i.policy.kinds_allowed = ["refund"]; }],
  ["COUNTERPARTY_DENIED", "block", i => { i.policy.counterparties.deny = ["vendor@example.com"]; }],
  ["COUNTERPARTY_NOT_ALLOWLISTED", "block", i => { i.policy.counterparties.allow = []; }],
  ["CATEGORY_DENIED", "block", i => { i.policy.categories.deny = ["design"]; }],
  ["CATEGORY_NOT_ALLOWLISTED", "block", i => { i.policy.categories.allow = []; }],
  ["PER_ACTION_LIMIT_EXCEEDED", "block", i => { i.policy.limits.per_action_max = money("10.00"); }],
  ["DAILY_LIMIT_EXCEEDED", "block", i => { i.policy.limits.daily_max = money("20.00"); i.history.spent_today = 1000; }],
  ["WEEKLY_LIMIT_EXCEEDED", "block", i => { i.policy.limits.weekly_max = money("20.00"); i.history.spent_week = 1000; }],
  ["MONTHLY_LIMIT_EXCEEDED", "block", i => { i.policy.limits.monthly_max = money("20.00"); i.history.spent_month = 1000; }],
  ["APPROVAL_REQUIRED_KIND", "hold", i => { i.policy.approval.always_for_kinds = ["payout"]; }],
  ["APPROVAL_REQUIRED_AMOUNT", "hold", i => { i.policy.approval.require_above = money("10.00"); }],
  ["NEW_COUNTERPARTY", "hold", i => { i.policy.approval.new_counterparty = true; }],
  ["VELOCITY_EXCEEDED", "hold", i => { i.policy.velocity.max_actions_per_hour = 2; i.history.actions_last_hour = 2; }],
  ["OUTSIDE_SCHEDULE", "hold", i => { i.policy.schedule = { days: ["tue"], start_hour: 9, end_hour: 17, tz: "UTC" }; }],
  ["AMOUNT_ANOMALY", "warn", i => { i.history.amount_stats = { n: 5, mean_cents: 700, stddev_cents: 100 }; }],
];

describe("evaluatePolicy", () => {
  it.each(rules)("produces %s", (code, severity, configure) => {
    const i = input(); configure(i);
    const result = evaluatePolicy(i);
    expect(result.verdict).toBe(severity === "warn" ? "allow" : severity);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code, severity, source: code === "AMOUNT_ANOMALY" ? "anomaly" : "policy" });
    expect(FindingSchema.safeParse(result.findings[0]).success).toBe(true);
  });

  it("allows without findings and never mutates inputs", () => {
    const i = input(); const before = structuredClone(i);
    expect(evaluatePolicy(i)).toEqual({ verdict: "allow", findings: [] });
    expect(i).toEqual(before);
    expect(evaluatePolicy(i)).toEqual(evaluatePolicy(i));
  });

  it.each([false, true])("skips all counterparty rules for orders (provided: %s)", provided => {
    const i = input();
    i.request = { ...i.request, kind: "order_create", counterparty: provided ? { type: "email", value: "vendor@example.com" } : undefined };
    i.policy.counterparties = { allow: [], deny: ["vendor@example.com"] };
    i.policy.approval.new_counterparty = true;
    expect(evaluatePolicy(i).findings).toEqual([]);
  });

  it("accepts known, allowlisted counterparties and categories", () => {
    const i = input();
    i.policy.counterparties = { allow: ["vendor@example.com"], deny: ["other@example.com"] };
    i.policy.categories = { allow: ["design"], deny: ["other"] };
    i.policy.approval = { new_counterparty: true, always_for_kinds: ["refund"] };
    i.history.known_counterparties = ["vendor@example.com"];
    expect(evaluatePolicy(i).findings).toEqual([]);
  });

  it("blocks missing category when an allowlist is configured", () => {
    const i = input(); delete i.request.category; i.policy.categories.allow = ["design"];
    expect(evaluatePolicy(i).findings.map(f => f.code)).toEqual(["CATEGORY_NOT_ALLOWLISTED"]);
  });

  it("allows missing category without an allowlist", () => {
    const i = input(); delete i.request.category;
    expect(evaluatePolicy(i).findings).toEqual([]);
  });

  it.each(["per_action_max", "daily_max", "weekly_max", "monthly_max"] as const)("allows exact %s and blocks one cent above", key => {
    const i = input(); i.policy.limits[key] = money("10.01");
    expect(evaluatePolicy(i).verdict).toBe("allow");
    i.request.amount = money("10.02");
    expect(evaluatePolicy(i).verdict).toBe("block");
  });

  it("allows equality at approval threshold and below velocity", () => {
    const i = input(); i.policy.approval.require_above = money("10.01");
    i.policy.velocity.max_actions_per_hour = 2; i.history.actions_last_hour = 1;
    expect(evaluatePolicy(i).findings).toEqual([]);
  });

  it.each([
    [4, 100, 700], [5, 0, 700], [5, 100, 701], [5, 100, 2000],
  ])("skips anomaly at n=%s, deviation=%s, mean=%s", (n, stddev_cents, mean_cents) => {
    const i = input(); i.history.amount_stats = { n, stddev_cents, mean_cents };
    expect(evaluatePolicy(i).findings).toEqual([]);
  });

  it.each([
    ["2026-10-26T08:59:59Z", 9, 17, false],
    ["2026-10-26T09:00:00Z", 9, 17, true],
    ["2026-10-26T16:59:59Z", 9, 17, true],
    ["2026-10-26T17:00:00Z", 9, 17, false],
    ["2026-10-26T23:00:00Z", 22, 6, true],
    ["2026-10-26T00:00:00Z", 22, 6, true],
    ["2026-10-26T12:00:00Z", 22, 6, false],
    ["2026-10-26T06:00:00Z", 22, 6, false],
    ["2026-10-26T12:00:00Z", 12, 12, false],
  ])("evaluates schedule %s [%s,%s)", (date, start_hour, end_hour, allowed) => {
    const i = input(); i.now = new Date(date);
    i.policy.schedule = { days: ["mon"], start_hour, end_hour, tz: "UTC" };
    expect(evaluatePolicy(i).verdict).toBe(allowed ? "allow" : "hold");
  });

  it.each(["2026-07-06T13:00:00Z", "2026-01-05T14:00:00Z"])("uses timezone and seasonal offset: %s", date => {
    const i = input(); i.now = new Date(date);
    i.policy.schedule = { days: ["mon"], start_hour: 9, end_hour: 10, tz: "America/New_York" };
    expect(evaluatePolicy(i).verdict).toBe("allow");
  });

  it("uses local weekday across UTC midnight", () => {
    const i = input(); i.now = new Date("2026-10-27T01:00:00Z");
    i.policy.schedule = { days: ["mon"], start_hour: 20, end_hour: 22, tz: "America/New_York" };
    expect(evaluatePolicy(i).verdict).toBe("allow");
  });

  it.each([true, false])("retains all findings when a block is present: %s", block => {
    const i = input();
    for (const [code, , configure] of rules) {
      if (block || !code.includes("EXCEEDED") && !["KIND_NOT_ALLOWED", "COUNTERPARTY_DENIED", "COUNTERPARTY_NOT_ALLOWLISTED", "CATEGORY_DENIED", "CATEGORY_NOT_ALLOWLISTED"].includes(code)) configure(i);
    }
    const result = evaluatePolicy(i);
    expect(result.verdict).toBe(block ? "block" : "hold");
    expect(result.findings.some(f => f.severity === "hold")).toBe(true);
    expect(result.findings.some(f => f.source === "anomaly")).toBe(true);
    if (block) expect(result.findings).toHaveLength(rules.length);
  });
});
