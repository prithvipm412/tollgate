import { z } from "zod";

const VerdictCountsSchema = z.object({
  allow: z.number().int().nonnegative(),
  hold: z.number().int().nonnegative(),
  block: z.number().int().nonnegative(),
});

/** GET /v1/stats/overview — dashboard summary tiles, computed for "today" in the operator's tz. */
export const StatsOverviewSchema = z.object({
  date: z.string().date(),
  counts_by_verdict: VerdictCountsSchema,
  /** Sum of cents across today's held + blocked actions — the "money protected" headline number. */
  money_protected_cents: z.number().int().nonnegative(),
  pending_approvals_count: z.number().int().nonnegative(),
  /** 24 hourly buckets, oldest first, ending with the current hour. */
  hourly_series: z
    .array(
      z.object({
        hour: z.string().datetime(),
        counts: VerdictCountsSchema,
      }),
    )
    .length(24),
});
export type StatsOverview = z.infer<typeof StatsOverviewSchema>;
