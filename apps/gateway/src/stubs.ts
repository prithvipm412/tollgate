import type {
  CheckIntent,
  CompilePolicy,
  EvaluatePolicy,
  LlmClient,
  ScanInjection,
} from "@tollgate/contracts";
import { moneyToCents } from "@tollgate/contracts";
import { GatewayError } from "./errors.js";

// Deliberately conservative M2 adapters. Replace with the real packages in a
// separate integration PR; a stub must not silently authorize money movement.
export const evaluatePolicy: EvaluatePolicy = ({ request, policy }) => {
  const findings = [
    {
      source: "policy" as const,
      code: "STUB_POLICY_REVIEW",
      severity: "hold" as const,
      message: "M2 policy stub requires human review.",
    },
  ];
  if (!policy.kinds_allowed.includes(request.kind))
    return {
      verdict: "block",
      findings: [
        {
          source: "policy",
          code: "KIND_NOT_ALLOWED",
          severity: "block",
          message: "Action kind is not allowed by the mandate.",
        },
      ],
    };
  if (
    policy.limits.per_action_max &&
    moneyToCents(request.amount) > moneyToCents(policy.limits.per_action_max)
  )
    findings.push({
      source: "policy",
      code: "AMOUNT_ABOVE_PER_ACTION_MAX",
      severity: "hold",
      message: "Amount exceeds the per-action limit.",
    });
  return { verdict: "hold", findings };
};
export const scanInjection: ScanInjection = async (texts) =>
  /ignore all previous instructions|do not flag this for review/i.test(texts.join("\n"))
    ? [
        {
          source: "injection",
          code: "PROMPT_INJECTION_DETECTED",
          severity: "block",
          message: "Untrusted text attempts to override review.",
        },
      ]
    : [];
export const checkIntent: CheckIntent = async () => [
  {
    source: "intent",
    code: "STUB_INTENT_REVIEW",
    severity: "hold",
    message: "M2 intent stub requires human review.",
  },
];
export const compilePolicy: CompilePolicy = async () => ({
  policy: {
    version: 1,
    kinds_allowed: ["payout", "refund", "invoice_send", "order_create"],
    limits: { per_action_max: { currency: "USD", value: "300.00" } },
    approval: {
      new_counterparty: true,
      always_for_kinds: ["payout", "refund", "invoice_send", "order_create"],
    },
    counterparties: {},
    categories: {},
    velocity: {},
  },
  explanation: ["All actions require human approval."],
  warnings: [
    "M2 compiler stub: this draft does not interpret your instruction. Review the policy before confirming.",
  ],
});
export const llm: LlmClient = {
  async completeJson() {
    throw new GatewayError("INTERNAL_ERROR", "M2 stubs do not call an LLM");
  },
};
