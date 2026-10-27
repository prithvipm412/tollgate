import type { ApprovalLinkView, ApprovalRequest } from "../src/index.js";
import { ACTION_PAYOUT_HELD_ID, actionPayoutHeld } from "./actions.js";
import { agentOps } from "./agents.js";
import { minutesAgo, minutesFromNow } from "./time.js";

export const APPROVAL_ID = "947c9121-4c10-4260-b542-93ab5d46496d";
/** Opaque bearer for the one-time link; the real token is HMAC-signed, this is a representative shape only. */
export const APPROVAL_LINK_TOKEN = "demo_9f8e7d6c5b4a3f2e1d0c";

export const approvalPending: ApprovalRequest = {
  id: APPROVAL_ID,
  action_id: ACTION_PAYOUT_HELD_ID,
  status: "pending",
  expires_at: minutesFromNow(7),
};

export const approvals: ApprovalRequest[] = [approvalPending];

export const approvalResolvedExample: ApprovalRequest = {
  id: APPROVAL_ID,
  action_id: ACTION_PAYOUT_HELD_ID,
  status: "approved",
  expires_at: minutesFromNow(7),
  decided_at: minutesAgo(1),
  decided_via: "dashboard",
};

export const approvalLinkView: ApprovalLinkView = {
  approval_id: APPROVAL_ID,
  action_id: ACTION_PAYOUT_HELD_ID,
  amount: actionPayoutHeld.request.amount,
  payee: actionPayoutHeld.request.counterparty,
  agent_name: agentOps.name,
  kind: actionPayoutHeld.request.kind,
  reason: actionPayoutHeld.request.reason,
  findings: actionPayoutHeld.decision!.findings,
  status: approvalPending.status,
  expires_at: approvalPending.expires_at,
};
