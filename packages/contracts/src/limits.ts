import { z } from "zod";

/** `limit_cents: null` means the policy sets no cap for this window. */
const LimitUsageSchema = z.object({
  limit_cents: z.number().int().positive().nullable(),
  used_cents: z.number().int().nonnegative(),
  remaining_cents: z.number().int().nullable(),
});

/** GET /v1/me/limits — what the calling agent's policy allows and how much headroom is left. */
export const LimitsResponseSchema = z.object({
  per_action: LimitUsageSchema,
  daily: LimitUsageSchema,
  weekly: LimitUsageSchema,
  monthly: LimitUsageSchema,
  velocity: z.object({
    max_actions_per_hour: z.number().int().positive().nullable(),
    actions_last_hour: z.number().int().nonnegative(),
  }),
});
export type LimitsResponse = z.infer<typeof LimitsResponseSchema>;
