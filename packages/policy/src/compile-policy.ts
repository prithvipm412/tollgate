import {
  PolicyCompileRequestSchema,
  PolicyCompileResponseSchema,
  type CompilePolicy,
} from "@tollgate/contracts";

const SYSTEM = `Compile the human's standing instruction into a draft Tollgate policy.
Return JSON { policy, explanation, warnings }. Explanation is an array of plain-English bullets describing the actual compiled rules. Warnings is an array quoting ambiguous phrases with no concrete number/rule (for example "a reasonable amount"). Do not silently invent amounts, categories, recipients, timezones, or schedules. Flag unsupported requirements and explain that they are not enforced. Human confirmation is required before enforcement.
Policy schema:
{ version: 1, kinds_allowed: nonempty array of "payout"|"refund"|"invoice_send"|"order_create",
  limits: { per_action_max?, daily_max?, weekly_max?, monthly_max? },
  approval: { require_above?, always_for_kinds?: action kinds[], new_counterparty: boolean },
  counterparties: { allow?: string[], deny?: string[] }, categories: { allow?: string[], deny?: string[] },
  velocity: { max_actions_per_hour?: positive integer },
  schedule?: { days: nonempty array of "mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun", start_hour: integer 0..23, end_hour: integer 0..23, tz: IANA timezone } }
Every amount is { currency: "USD", value: nonnegative decimal string with exactly two decimal places }.
All top-level policy objects are required except schedule; omit unspecified optional rules. Lists match literal strings, not wildcards. Limit violations BLOCK; approval thresholds HOLD, only when strictly exceeded. Order creation skips all counterparty rules. Schedule uses local weekdays and [start_hour,end_hour).
Examples:
Instruction: "Pay contractors; hold payments over $300 and first-time recipients."
JSON: {"policy":{"version":1,"kinds_allowed":["payout"],"limits":{},"approval":{"require_above":{"currency":"USD","value":"300.00"},"new_counterparty":true},"counterparties":{},"categories":{},"velocity":{}},"explanation":["Only payouts are allowed.","Payments above $300 and payments to new counterparties require approval."],"warnings":[]}
Instruction: "Refund up to $50 per payment, at most $200 daily. Keep amounts reasonable."
JSON: {"policy":{"version":1,"kinds_allowed":["refund"],"limits":{"per_action_max":{"currency":"USD","value":"50.00"},"daily_max":{"currency":"USD","value":"200.00"}},"approval":{"new_counterparty":false},"counterparties":{},"categories":{},"velocity":{}},"explanation":["Only refunds are allowed.","Refunds above $50 or exceeding $200 in daily spending are blocked."],"warnings":["'reasonable' has no concrete threshold; only the explicit limits are enforced."]}`;

/** LlmClient owns the single repair retry; compilation errors propagate to the caller. */
export const compilePolicy: CompilePolicy = async (instruction, llm) => {
  PolicyCompileRequestSchema.parse({ instruction });
  const result = await llm.completeJson({
    system: SYSTEM,
    user: instruction,
    schema: PolicyCompileResponseSchema,
    timeoutMs: 30_000,
  });
  // Validate at this boundary even when a caller supplies its own LlmClient.
  return PolicyCompileResponseSchema.parse(result);
};
