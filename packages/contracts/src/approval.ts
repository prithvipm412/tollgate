import { z } from "zod";
import { MoneySchema } from "./money.js";
import { ActionKindSchema, CounterpartySchema, FindingSchema } from "./action.js";

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalDecidedViaSchema = z.enum(["dashboard", "link"]);
export type ApprovalDecidedVia = z.infer<typeof ApprovalDecidedViaSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  action_id: z.string().uuid(),
  status: ApprovalStatusSchema,
  expires_at: z.string().datetime(),
  decided_at: z.string().datetime().optional(),
  decided_via: ApprovalDecidedViaSchema.optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/** What the mobile one-time approval link page renders. */
export const ApprovalLinkViewSchema = z.object({
  approval_id: z.string().uuid(),
  action_id: z.string().uuid(),
  amount: MoneySchema,
  payee: CounterpartySchema,
  agent_name: z.string().min(1),
  kind: ActionKindSchema,
  reason: z.string().min(1),
  findings: z.array(FindingSchema),
  status: ApprovalStatusSchema,
  expires_at: z.string().datetime(),
});
export type ApprovalLinkView = z.infer<typeof ApprovalLinkViewSchema>;
