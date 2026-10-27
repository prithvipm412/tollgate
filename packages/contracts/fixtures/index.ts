import { z } from "zod";
import {
  AgentCreateResponseSchema,
  AgentSchema,
  ApiErrorSchema,
  ApprovalLinkViewSchema,
  ApprovalRequestSchema,
  AuditEventSchema,
  AuditVerifyResultSchema,
  KillSwitchStateSchema,
  LimitsResponseSchema,
  MandateSchema,
  PolicyCompileRequestSchema,
  PolicyCompileResponseSchema,
  StatsOverviewSchema,
  ActionRecordSchema,
  TollgateEventSchema,
} from "../src/index.js";

export * from "./time.js";
export * from "./agents.js";
export * from "./mandates.js";
export * from "./actions.js";
export * from "./approvals.js";
export * from "./audit.js";
export * from "./killswitch.js";
export * from "./stats.js";
export * from "./limits.js";
export * from "./events.js";
export * from "./misc.js";

import { agentCreateResponseExample, agentFrozen, agentOps } from "./agents.js";
import { mandate } from "./mandates.js";
import { actionInvoiceInjected, actionOrderCreate, actionPayout1, actionPayoutHeld, actionRefund } from "./actions.js";
import { approvalLinkView, approvalPending, approvalResolvedExample } from "./approvals.js";
import { auditEvents, auditVerifyResult } from "./audit.js";
import { killSwitchDisengaged, killSwitchEngagedExample } from "./killswitch.js";
import { statsOverview } from "./stats.js";
import { limitsResponse } from "./limits.js";
import { sampleEvents } from "./events.js";
import { apiErrorExample, policyCompileRequest, policyCompileResponse } from "./misc.js";

/** Every (schema, sample value) pair, for exhaustive round-trip tests — one entry per schema in this list is a bug if missing. */
export const schemaFixtures: { name: string; schema: z.ZodTypeAny; value: unknown }[] = [
  { name: "Agent", schema: AgentSchema, value: agentOps },
  { name: "Agent (frozen)", schema: AgentSchema, value: agentFrozen },
  { name: "AgentCreateResponse", schema: AgentCreateResponseSchema, value: agentCreateResponseExample },
  { name: "Mandate", schema: MandateSchema, value: mandate },
  { name: "ActionRecord (allow/executed)", schema: ActionRecordSchema, value: actionPayout1 },
  { name: "ActionRecord (block)", schema: ActionRecordSchema, value: actionInvoiceInjected },
  { name: "ActionRecord (hold/pending_approval)", schema: ActionRecordSchema, value: actionPayoutHeld },
  { name: "ActionRecord (refund)", schema: ActionRecordSchema, value: actionRefund },
  { name: "ActionRecord (order_create, no counterparty)", schema: ActionRecordSchema, value: actionOrderCreate },
  { name: "ApprovalRequest (pending)", schema: ApprovalRequestSchema, value: approvalPending },
  { name: "ApprovalRequest (resolved)", schema: ApprovalRequestSchema, value: approvalResolvedExample },
  { name: "ApprovalLinkView", schema: ApprovalLinkViewSchema, value: approvalLinkView },
  { name: "AuditEvent[]", schema: z.array(AuditEventSchema), value: auditEvents },
  { name: "AuditVerifyResult", schema: AuditVerifyResultSchema, value: auditVerifyResult },
  { name: "KillSwitchState (disengaged)", schema: KillSwitchStateSchema, value: killSwitchDisengaged },
  { name: "KillSwitchState (engaged)", schema: KillSwitchStateSchema, value: killSwitchEngagedExample },
  { name: "StatsOverview", schema: StatsOverviewSchema, value: statsOverview },
  { name: "LimitsResponse", schema: LimitsResponseSchema, value: limitsResponse },
  { name: "PolicyCompileRequest", schema: PolicyCompileRequestSchema, value: policyCompileRequest },
  { name: "PolicyCompileResponse", schema: PolicyCompileResponseSchema, value: policyCompileResponse },
  { name: "ApiError", schema: ApiErrorSchema, value: apiErrorExample },
  ...sampleEvents.map((event) => ({ name: `TollgateEvent (${event.type})`, schema: TollgateEventSchema, value: event })),
];
