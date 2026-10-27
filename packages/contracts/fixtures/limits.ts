import type { LimitsResponse } from "../src/index.js";

const spentTodayCents = 25000 + 12000; // actionPayout1 ($250) + actionRefund ($120)

export const limitsResponse: LimitsResponse = {
  per_action: { limit_cents: 30000, used_cents: 0, remaining_cents: 30000 },
  daily: { limit_cents: 100000, used_cents: spentTodayCents, remaining_cents: 100000 - spentTodayCents },
  weekly: { limit_cents: 400000, used_cents: spentTodayCents, remaining_cents: 400000 - spentTodayCents },
  monthly: { limit_cents: 1200000, used_cents: spentTodayCents, remaining_cents: 1200000 - spentTodayCents },
  velocity: { max_actions_per_hour: 10, actions_last_hour: 4 },
};
