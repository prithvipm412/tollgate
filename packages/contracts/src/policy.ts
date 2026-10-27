import { z } from "zod";
import { MoneySchema } from "./money.js";
import { ActionKindSchema } from "./action.js";

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Policy document schema version 1. Bump PolicyDocumentSchema.version and add a new union member to change shape. */
export const PolicyDocumentSchema = z.object({
  version: z.literal(1),
  kinds_allowed: z.array(ActionKindSchema).min(1),
  limits: z.object({
    per_action_max: MoneySchema.optional(),
    daily_max: MoneySchema.optional(),
    weekly_max: MoneySchema.optional(),
    monthly_max: MoneySchema.optional(),
  }),
  approval: z.object({
    require_above: MoneySchema.optional(),
    always_for_kinds: z.array(ActionKindSchema).optional(),
    new_counterparty: z.boolean(),
  }),
  counterparties: z.object({
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  }),
  categories: z.object({
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  }),
  velocity: z.object({
    max_actions_per_hour: z.number().int().positive().optional(),
  }),
  schedule: z
    .object({
      days: z.array(WeekdaySchema).min(1),
      start_hour: z.number().int().min(0).max(23),
      end_hour: z.number().int().min(0).max(23),
      tz: z.string().min(1),
    })
    .optional(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const PolicyCompileRequestSchema = z.object({
  instruction: z.string().min(1).max(4000),
});
export type PolicyCompileRequest = z.infer<typeof PolicyCompileRequestSchema>;

export const PolicyCompileResponseSchema = z.object({
  policy: PolicyDocumentSchema,
  explanation: z.array(z.string().min(1)).min(1),
  warnings: z.array(z.string().min(1)),
});
export type PolicyCompileResponse = z.infer<typeof PolicyCompileResponseSchema>;
