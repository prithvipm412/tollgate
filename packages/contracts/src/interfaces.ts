import type { z } from "zod";
import type { Counterparty, PaymentActionRequest, Finding, Verdict } from "./action.js";
import type { Money } from "./money.js";
import type { PolicyDocument, PolicyCompileResponse } from "./policy.js";
import type { Mandate } from "./mandate.js";

/** Pre-aggregated per-agent history the policy engine needs; computed by the gateway/db layer. */
export interface AgentHistory {
  spent_today: number;
  spent_week: number;
  spent_month: number;
  actions_last_hour: number;
  known_counterparties: string[];
  amount_stats: { mean_cents: number; stddev_cents: number; n: number };
}

/** packages/policy — pure, synchronous, no I/O, not reachable by agent-supplied free text. */
export type EvaluatePolicy = (input: {
  request: PaymentActionRequest;
  policy: PolicyDocument;
  history: AgentHistory;
  now: Date;
}) => { verdict: Verdict; findings: Finding[] };

/** packages/policy — translates the human's plain-English mandate into a PolicyDocument. */
export type CompilePolicy = (instruction: string, llm: LlmClient) => Promise<PolicyCompileResponse>;

/** packages/guard-ai — scans untrusted text (reason, source_context) for injected instructions. */
export type ScanInjection = (texts: string[], llm: LlmClient) => Promise<Finding[]>;

/** packages/guard-ai — checks whether a request fits the agent's standing mandate. */
export type CheckIntent = (input: { mandate: Mandate; request: PaymentActionRequest }, llm: LlmClient) => Promise<Finding[]>;

/** packages/guard-ai — thin wrapper over an OpenAI-compatible endpoint that enforces a JSON schema on the reply. */
export interface LlmClient {
  completeJson<T>(opts: { system: string; user: string; schema: z.ZodType<T>; timeoutMs: number }): Promise<T>;
}

export interface PayPalPayoutResult {
  payout_item_id: string;
  status: string;
}
export interface PayPalRefundResult {
  refund_id: string;
  status: string;
}
export interface PayPalInvoiceResult {
  invoice_id: string;
  status: string;
}
export interface PayPalOrderResult {
  order_id: string;
  status: string;
  approve_url?: string;
}

/** packages/paypal — every method is idempotent on `action_id` via PayPal-Request-Id. */
export interface PayPalClient {
  createPayout(input: { action_id: string; amount: Money; recipient: Counterparty }): Promise<PayPalPayoutResult>;
  refundCapture(input: { action_id: string; capture_id: string; amount?: Money }): Promise<PayPalRefundResult>;
  createAndSendInvoice(input: {
    action_id: string;
    amount: Money;
    recipient: Counterparty;
    memo?: string;
  }): Promise<PayPalInvoiceResult>;
  createOrder(input: { action_id: string; amount: Money }): Promise<PayPalOrderResult>;
  verifyWebhook(input: { headers: Record<string, string>; body: string }): Promise<boolean>;
}
