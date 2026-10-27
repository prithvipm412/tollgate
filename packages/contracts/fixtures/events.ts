import type { TollgateEvent } from "../src/index.js";
import { actionPayout1, actionRefund } from "./actions.js";
import { agentFrozen } from "./agents.js";
import { approvalPending, approvalResolvedExample } from "./approvals.js";
import { killSwitchDisengaged } from "./killswitch.js";

/** One example per union member, for schema coverage — not a strict chronological narrative. */
export const sampleEvents: TollgateEvent[] = [
  { id: "1", type: "action.received", payload: actionPayout1 },
  { id: "2", type: "action.decided", payload: actionPayout1 },
  { id: "3", type: "action.executed", payload: actionPayout1 },
  { id: "4", type: "action.failed", payload: actionRefund },
  { id: "5", type: "approval.created", payload: approvalPending },
  { id: "6", type: "approval.resolved", payload: approvalResolvedExample },
  { id: "7", type: "agent.frozen", payload: agentFrozen },
  { id: "8", type: "killswitch.changed", payload: killSwitchDisengaged },
];
