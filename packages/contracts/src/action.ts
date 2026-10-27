import { z } from "zod";
import { MoneySchema } from "./money.js";

export const ActionKindSchema = z.enum(["payout", "refund", "invoice_send", "order_create"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const CounterpartyTypeSchema = z.enum(["email", "paypal_payer_id", "capture_id"]);
export type CounterpartyType = z.infer<typeof CounterpartyTypeSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CounterpartySchema = z
  .object({
    type: CounterpartyTypeSchema,
    value: z.string().min(1),
    display_name: z.string().min(1).optional(),
  })
  .superRefine((cp, ctx) => {
    if (cp.type === "email" && !EMAIL_RE.test(cp.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "must be a valid email when type is 'email'" });
    }
  });
export type Counterparty = z.infer<typeof CounterpartySchema>;

const PaymentActionRequestBaseSchema = z.object({
  action_id: z.string().uuid(),
  amount: MoneySchema,
  category: z.string().max(100).optional(),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(2000),
  source_context: z.array(z.string().max(4000)).max(5).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

/**
 * `counterparty` is required for every kind except `order_create` — an
 * order has no known payer until the buyer completes checkout, so
 * counterparty/new-counterparty policy rules are skipped for it (see
 * docs/CONTRACT.md). Modeled as a discriminated union (rather than a
 * refinement) so consumers get a real type-level guarantee: narrowing on
 * `kind` is enough to know whether `counterparty` is present, with no
 * runtime-only check required.
 */
export const PaymentActionRequestSchema = z.discriminatedUnion("kind", [
  PaymentActionRequestBaseSchema.extend({ kind: z.literal("payout"), counterparty: CounterpartySchema }),
  PaymentActionRequestBaseSchema.extend({ kind: z.literal("refund"), counterparty: CounterpartySchema }),
  PaymentActionRequestBaseSchema.extend({ kind: z.literal("invoice_send"), counterparty: CounterpartySchema }),
  PaymentActionRequestBaseSchema.extend({ kind: z.literal("order_create"), counterparty: CounterpartySchema.optional() }),
]);
export type PaymentActionRequest = z.infer<typeof PaymentActionRequestSchema>;

export const FindingSourceSchema = z.enum(["policy", "anomaly", "injection", "intent", "system"]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSeveritySchema = z.enum(["info", "warn", "hold", "block"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingSchema = z.object({
  source: FindingSourceSchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "must be UPPER_SNAKE_CASE"),
  severity: FindingSeveritySchema,
  message: z.string().min(1),
  evidence: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const VerdictSchema = z.enum(["allow", "hold", "block"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const DecisionSchema = z.object({
  verdict: VerdictSchema,
  risk_score: z.number().int().min(0).max(100),
  findings: z.array(FindingSchema),
  policy_version: z.number().int().positive(),
  decided_at: z.string().datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ActionStatusSchema = z.enum([
  "received",
  "blocked",
  "pending_approval",
  "approved",
  "denied",
  "expired",
  "executing",
  "executed",
  "failed",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionRecordSchema = z.object({
  request: PaymentActionRequestSchema,
  agent_id: z.string().uuid(),
  decision: DecisionSchema.optional(),
  status: ActionStatusSchema,
  paypal_resource_id: z.string().optional(),
  error: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;
