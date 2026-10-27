import { AUDIT_GENESIS_HASH, computeAuditHash, verifyAuditChain } from "../src/audit-hash.js";
import type { AuditEvent, AuditVerifyResult } from "../src/index.js";
import { ACTION_INVOICE_INJECTED_ID, ACTION_PAYOUT_1_ID, ACTION_PAYOUT_HELD_ID, ACTION_REFUND_ID } from "./actions.js";
import { AGENT_OPS_ID } from "./agents.js";
import { APPROVAL_ID } from "./approvals.js";
import { MANDATE_ID } from "./mandates.js";
import { minutesAgo, minutesFromNow } from "./time.js";

interface RawStep {
  ts: string;
  type: string;
  action_id?: string;
  agent_id?: string;
  payload: Record<string, unknown>;
}

/** Chronological, oldest first — the order they'd really have been appended in. */
const steps: RawStep[] = [
  { ts: minutesAgo(60 * 24 * 7), type: "mandate.confirmed", agent_id: AGENT_OPS_ID, payload: { mandate_id: MANDATE_ID, agent_id: AGENT_OPS_ID, version: 1 } },

  { ts: minutesAgo(46), type: "action.received", action_id: ACTION_PAYOUT_1_ID, agent_id: AGENT_OPS_ID, payload: { action_id: ACTION_PAYOUT_1_ID, kind: "payout" } },
  { ts: minutesAgo(45), type: "decision.made", action_id: ACTION_PAYOUT_1_ID, payload: { action_id: ACTION_PAYOUT_1_ID, verdict: "allow", risk_score: 8 } },
  { ts: minutesAgo(44), type: "action.executed", action_id: ACTION_PAYOUT_1_ID, payload: { action_id: ACTION_PAYOUT_1_ID, paypal_resource_id: "PAYOUTITEM-7FQ2K9S3" } },

  { ts: minutesAgo(31), type: "action.received", action_id: ACTION_INVOICE_INJECTED_ID, agent_id: AGENT_OPS_ID, payload: { action_id: ACTION_INVOICE_INJECTED_ID, kind: "invoice_send" } },
  { ts: minutesAgo(30), type: "decision.made", action_id: ACTION_INVOICE_INJECTED_ID, payload: { action_id: ACTION_INVOICE_INJECTED_ID, verdict: "block", risk_score: 97 } },
  { ts: minutesAgo(30), type: "action.blocked", action_id: ACTION_INVOICE_INJECTED_ID, payload: { action_id: ACTION_INVOICE_INJECTED_ID, reason_code: "PROMPT_INJECTION_DETECTED" } },

  { ts: minutesAgo(16), type: "action.received", action_id: ACTION_REFUND_ID, agent_id: AGENT_OPS_ID, payload: { action_id: ACTION_REFUND_ID, kind: "refund" } },
  { ts: minutesAgo(15), type: "decision.made", action_id: ACTION_REFUND_ID, payload: { action_id: ACTION_REFUND_ID, verdict: "allow", risk_score: 12 } },
  { ts: minutesAgo(14), type: "action.executed", action_id: ACTION_REFUND_ID, payload: { action_id: ACTION_REFUND_ID, paypal_resource_id: "REFUND-9K2M4P7Q" } },

  { ts: minutesAgo(9), type: "action.received", action_id: ACTION_PAYOUT_HELD_ID, agent_id: AGENT_OPS_ID, payload: { action_id: ACTION_PAYOUT_HELD_ID, kind: "payout" } },
  { ts: minutesAgo(8), type: "decision.made", action_id: ACTION_PAYOUT_HELD_ID, payload: { action_id: ACTION_PAYOUT_HELD_ID, verdict: "hold", risk_score: 55 } },
  { ts: minutesAgo(8), type: "approval.created", action_id: ACTION_PAYOUT_HELD_ID, payload: { approval_id: APPROVAL_ID, action_id: ACTION_PAYOUT_HELD_ID, expires_at: minutesFromNow(7) } },
];

function buildChain(rawSteps: RawStep[]): AuditEvent[] {
  let prevHash = AUDIT_GENESIS_HASH;
  return rawSteps.map((step, seq) => {
    const hash = computeAuditHash(prevHash, step.payload);
    const event: AuditEvent = {
      seq,
      ts: step.ts,
      type: step.type,
      action_id: step.action_id,
      agent_id: step.agent_id,
      payload: step.payload,
      prev_hash: prevHash,
      hash,
    };
    prevHash = hash;
    return event;
  });
}

export const auditEvents: AuditEvent[] = buildChain(steps);
export const auditVerifyResult: AuditVerifyResult = verifyAuditChain(auditEvents);
