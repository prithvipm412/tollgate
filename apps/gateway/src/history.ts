import { moneyToCents } from "@tollgate/contracts";
import type {
  ActionRecord,
  AgentHistory,
  LimitsResponse,
  PolicyDocument,
} from "@tollgate/contracts";
export function historyFor(actions: ActionRecord[], now: Date): AgentHistory {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const week = day - ((now.getUTCDay() + 6) % 7) * 86_400_000;
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Pending/executing amounts reserve headroom; approvals cannot multiply exposure.
  const reserved = actions.filter((a) =>
    ["executed", "executing", "pending_approval", "approved"].includes(a.status),
  );
  const spent = (since: number) =>
    reserved
      .filter((a) => a.status !== "executed" || Date.parse(a.updated_at) >= since)
      .reduce((total, a) => total + moneyToCents(a.request.amount), 0);
  const paid = actions.filter((a) => a.status === "executed");
  const amounts = paid.map((a) => moneyToCents(a.request.amount));
  const mean = amounts.reduce((a, b) => a + b, 0) / (amounts.length || 1);
  return {
    spent_today: spent(day),
    spent_week: spent(week),
    spent_month: spent(month),
    actions_last_hour: actions.filter((a) => Date.parse(a.created_at) > now.getTime() - 3_600_000)
      .length,
    known_counterparties: [
      ...new Set(
        paid.flatMap((a) => (a.request.counterparty ? [a.request.counterparty.value] : [])),
      ),
    ],
    amount_stats: {
      mean_cents: mean,
      stddev_cents: Math.sqrt(
        amounts.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (amounts.length || 1),
      ),
      n: amounts.length,
    },
  };
}
export function limitsFor(policy: PolicyDocument, history: AgentHistory): LimitsResponse {
  const usage = (cap: PolicyDocument["limits"]["daily_max"], used_cents: number) => {
    const limit_cents = cap ? moneyToCents(cap) : null;
    return {
      limit_cents,
      used_cents,
      remaining_cents: limit_cents === null ? null : limit_cents - used_cents,
    };
  };
  return {
    per_action: usage(policy.limits.per_action_max, 0),
    daily: usage(policy.limits.daily_max, history.spent_today),
    weekly: usage(policy.limits.weekly_max, history.spent_week),
    monthly: usage(policy.limits.monthly_max, history.spent_month),
    velocity: {
      max_actions_per_hour: policy.velocity.max_actions_per_hour ?? null,
      actions_last_hour: history.actions_last_hour,
    },
  };
}
