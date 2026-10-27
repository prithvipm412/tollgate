import { moneyToCents } from "../src/index.js";
import type { StatsOverview } from "../src/index.js";
import { actionInvoiceInjected, actionPayoutHeld } from "./actions.js";

const now = new Date();
const hourMs = 60 * 60 * 1000;
const currentHourStart = new Date(Math.floor(now.getTime() / hourMs) * hourMs);

const moneyProtectedCents = moneyToCents(actionInvoiceInjected.request.amount) + moneyToCents(actionPayoutHeld.request.amount);

const hourlySeries = Array.from({ length: 24 }, (_, i) => {
  const hoursFromOldest = i;
  const hour = new Date(currentHourStart.getTime() - (23 - hoursFromOldest) * hourMs).toISOString();
  const isCurrentHour = hoursFromOldest === 23;
  return {
    hour,
    counts: isCurrentHour ? { allow: 2, hold: 1, block: 1 } : { allow: 0, hold: 0, block: 0 },
  };
});

export const statsOverview: StatsOverview = {
  date: now.toISOString().slice(0, 10),
  counts_by_verdict: { allow: 2, hold: 1, block: 1 },
  money_protected_cents: moneyProtectedCents,
  pending_approvals_count: 1,
  hourly_series: hourlySeries as StatsOverview["hourly_series"],
};
