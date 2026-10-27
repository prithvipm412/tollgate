import { describe, expect, it } from "vitest";
import type { ActionRecord, PolicyDocument } from "@tollgate/contracts";
import { historyFor, limitsFor } from "./history.js";
import { request } from "./test-support.js";
const now = new Date("2026-11-02T00:05:00Z"); // Monday, just after the month boundary.
const action = (
  status: ActionRecord["status"],
  created_at: string,
  updated_at = created_at,
): ActionRecord => ({ request: request(), agent_id: "test", status, created_at, updated_at });
describe("usage history", () => {
  it("uses execution time for spend and reserves every pending amount across UTC boundaries", () => {
    const actions = [
      action("executed", "2026-11-01T23:50:00Z", "2026-11-02T00:01:00Z"),
      action("executed", "2026-10-31T23:50:00Z"),
      action("pending_approval", "2026-11-01T23:55:00Z"),
      action("blocked", "2026-11-02T00:01:00Z"),
      action("failed", "2026-11-02T00:02:00Z"),
    ];
    const history = historyFor(actions, now);
    expect(history).toMatchObject({
      spent_today: 5000,
      spent_week: 5000,
      spent_month: 5000,
      actions_last_hour: 4,
      amount_stats: { mean_cents: 2500, stddev_cents: 0, n: 2 },
    });
    expect(history.known_counterparties).toEqual(["contractor@example.com"]);
  });
  it("reports uncapped limits without NaN statistics and capped overages as negative headroom", () => {
    const empty = historyFor([], now);
    expect(empty.amount_stats).toEqual({ mean_cents: 0, stddev_cents: 0, n: 0 });
    const policy: PolicyDocument = {
      version: 1,
      kinds_allowed: ["payout"],
      limits: { daily_max: { currency: "USD", value: "1.00" } },
      approval: { new_counterparty: false },
      counterparties: {},
      categories: {},
      velocity: {},
    };
    const limits = limitsFor(policy, { ...empty, spent_today: 125 });
    expect(limits.daily).toEqual({ limit_cents: 100, used_cents: 125, remaining_cents: -25 });
    expect(limits.monthly).toEqual({ limit_cents: null, used_cents: 0, remaining_cents: null });
  });
});
