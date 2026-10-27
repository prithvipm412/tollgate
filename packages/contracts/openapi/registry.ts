import { OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  ActionRecordSchema,
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
  PaymentActionRequestSchema,
  PolicyCompileRequestSchema,
  PolicyCompileResponseSchema,
  PolicyDocumentSchema,
  StatsOverviewSchema,
  pageSchema,
} from "../src/index.js";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

function reg<T extends z.ZodTypeAny>(name: string, schema: T) {
  return registry.register(name, schema.openapi(name));
}

reg("Money", z.object({ currency: z.enum(["USD"]), value: z.string() }).openapi({ example: { currency: "USD", value: "12.50" } }));
const PaymentActionRequest = reg("PaymentActionRequest", PaymentActionRequestSchema);
const ActionRecord = reg("ActionRecord", ActionRecordSchema);
const Agent = reg("Agent", AgentSchema);
const AgentCreateResponse = reg("AgentCreateResponse", AgentCreateResponseSchema);
const Mandate = reg("Mandate", MandateSchema);
const PolicyDocument = reg("PolicyDocument", PolicyDocumentSchema);
const PolicyCompileRequest = reg("PolicyCompileRequest", PolicyCompileRequestSchema);
const PolicyCompileResponse = reg("PolicyCompileResponse", PolicyCompileResponseSchema);
const ApprovalRequest = reg("ApprovalRequest", ApprovalRequestSchema);
const ApprovalLinkView = reg("ApprovalLinkView", ApprovalLinkViewSchema);
reg("AuditEvent", AuditEventSchema);
const AuditVerifyResult = reg("AuditVerifyResult", AuditVerifyResultSchema);
const KillSwitchState = reg("KillSwitchState", KillSwitchStateSchema);
const StatsOverview = reg("StatsOverview", StatsOverviewSchema);
const LimitsResponse = reg("LimitsResponse", LimitsResponseSchema);
const ApiError = reg("ApiError", ApiErrorSchema);

const PageOfActionRecord = reg("PageOfActionRecord", pageSchema(ActionRecordSchema));
const PageOfApprovalRequest = reg("PageOfApprovalRequest", pageSchema(ApprovalRequestSchema));
const PageOfAgent = reg("PageOfAgent", pageSchema(AgentSchema));
const PageOfAuditEvent = reg("PageOfAuditEvent", pageSchema(AuditEventSchema));

registry.registerComponent("securitySchemes", "agentKey", {
  type: "http",
  scheme: "bearer",
  description: "Agent API key, e.g. 'tg_ab12...'",
});
registry.registerComponent("securitySchemes", "adminSession", {
  type: "apiKey",
  in: "cookie",
  name: "tg_session",
  description: "httpOnly session cookie from POST /v1/auth/login",
});

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ApiError } },
});

function path(config: Parameters<typeof registry.registerPath>[0]) {
  registry.registerPath(config);
}

// ---- Agent-auth ----
path({
  method: "post",
  path: "/v1/actions",
  tags: ["actions"],
  summary: "Submit a payment action for Tollgate to evaluate and (if allowed) execute.",
  security: [{ agentKey: [] }],
  request: { body: { content: { "application/json": { schema: PaymentActionRequest } } } },
  responses: {
    200: { description: "The resulting action record (may be allow/hold/block).", content: { "application/json": { schema: ActionRecord } } },
    401: errorResponse("Missing/invalid agent key, frozen agent, or kill switch engaged."),
    422: errorResponse("Request failed schema validation."),
  },
});

path({
  method: "get",
  path: "/v1/actions/{id}",
  tags: ["actions"],
  summary: "Get one action by id. Accepts either the agent's own key or an admin session.",
  security: [{ agentKey: [] }, { adminSession: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "The action record.", content: { "application/json": { schema: ActionRecord } } },
    404: errorResponse("No action with that id."),
  },
});

path({
  method: "get",
  path: "/v1/me/limits",
  tags: ["actions"],
  summary: "The calling agent's policy limits and current usage.",
  security: [{ agentKey: [] }],
  responses: { 200: { description: "Limits and usage.", content: { "application/json": { schema: LimitsResponse } } } },
});

// ---- Admin-auth ----
path({
  method: "post",
  path: "/v1/auth/login",
  tags: ["admin"],
  summary: "Log in as the operator with ADMIN_PASSWORD; sets an httpOnly session cookie.",
  request: { body: { content: { "application/json": { schema: z.object({ password: z.string() }) } } } },
  responses: { 200: { description: "Logged in." }, 401: errorResponse("Wrong password.") },
});

path({
  method: "get",
  path: "/v1/actions",
  tags: ["admin"],
  summary: "List actions, optionally filtered by status/agent_id, cursor-paginated.",
  security: [{ adminSession: [] }],
  request: {
    query: z.object({
      status: z.string().optional(),
      agent_id: z.string().uuid().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: { description: "A page of actions.", content: { "application/json": { schema: PageOfActionRecord } } } },
});

path({
  method: "get",
  path: "/v1/approvals",
  tags: ["admin"],
  summary: "List approval requests, optionally filtered by status.",
  security: [{ adminSession: [] }],
  request: { query: z.object({ status: z.string().optional() }) },
  responses: { 200: { description: "A page of approval requests.", content: { "application/json": { schema: PageOfApprovalRequest } } } },
});

for (const decision of ["approve", "deny"] as const) {
  path({
    method: "post",
    path: `/v1/approvals/{id}/${decision}`,
    tags: ["admin"],
    summary: `${decision === "approve" ? "Approve" : "Deny"} a pending approval from the dashboard.`,
    security: [{ adminSession: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: { description: "The updated approval request.", content: { "application/json": { schema: ApprovalRequest } } },
      409: errorResponse("Already resolved or expired."),
    },
  });
}

path({
  method: "get",
  path: "/v1/agents",
  tags: ["admin"],
  summary: "List agents.",
  security: [{ adminSession: [] }],
  responses: { 200: { description: "A page of agents.", content: { "application/json": { schema: PageOfAgent } } } },
});

path({
  method: "post",
  path: "/v1/agents",
  tags: ["admin"],
  summary: "Create a new agent. The response includes the raw API key once.",
  security: [{ adminSession: [] }],
  request: { body: { content: { "application/json": { schema: z.object({ name: z.string().min(1) }) } } } },
  responses: { 200: { description: "The new agent, with its raw key.", content: { "application/json": { schema: AgentCreateResponse } } } },
});

for (const action of ["freeze", "unfreeze", "rotate-key"] as const) {
  path({
    method: "post",
    path: `/v1/agents/{id}/${action}`,
    tags: ["admin"],
    summary: `${action === "rotate-key" ? "Rotate an agent's API key (old key stops working immediately)" : `Set an agent's status to ${action === "freeze" ? "frozen" : "active"}`}.`,
    security: [{ adminSession: [] }],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: "The updated agent (rotate-key also returns the new raw key).",
        content: { "application/json": { schema: action === "rotate-key" ? AgentCreateResponse : Agent } },
      },
    },
  });
}

path({
  method: "post",
  path: "/v1/mandates/compile",
  tags: ["admin"],
  summary: "Compile a plain-English instruction into a draft PolicyDocument for the human to review.",
  security: [{ adminSession: [] }],
  request: { body: { content: { "application/json": { schema: PolicyCompileRequest } } } },
  responses: { 200: { description: "Draft policy, explanation, and warnings.", content: { "application/json": { schema: PolicyCompileResponse } } } },
});

path({
  method: "post",
  path: "/v1/mandates",
  tags: ["admin"],
  summary: "Confirm a compiled policy, creating the enforced Mandate for an agent.",
  security: [{ adminSession: [] }],
  request: {
    body: { content: { "application/json": { schema: z.object({ agent_id: z.string().uuid(), instruction: z.string(), policy: PolicyDocument }) } } },
  },
  responses: { 200: { description: "The confirmed mandate.", content: { "application/json": { schema: Mandate } } } },
});

path({
  method: "get",
  path: "/v1/agents/{id}/mandate",
  tags: ["admin"],
  summary: "Get an agent's current confirmed mandate.",
  security: [{ adminSession: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "The mandate.", content: { "application/json": { schema: Mandate } } },
    404: errorResponse("Agent has no confirmed mandate yet."),
  },
});

path({
  method: "get",
  path: "/v1/killswitch",
  tags: ["admin"],
  summary: "Get the global kill switch state.",
  security: [{ adminSession: [] }],
  responses: { 200: { description: "Kill switch state.", content: { "application/json": { schema: KillSwitchState } } } },
});

path({
  method: "post",
  path: "/v1/killswitch",
  tags: ["admin"],
  summary: "Engage or disengage the global kill switch. While engaged, every action is rejected before policy evaluation.",
  security: [{ adminSession: [] }],
  request: { body: { content: { "application/json": { schema: z.object({ engaged: z.boolean(), reason: z.string().optional() }) } } } },
  responses: { 200: { description: "The updated kill switch state.", content: { "application/json": { schema: KillSwitchState } } } },
});

path({
  method: "get",
  path: "/v1/audit",
  tags: ["admin"],
  summary: "List the hash-chained audit log, cursor-paginated by seq.",
  security: [{ adminSession: [] }],
  request: { query: z.object({ cursor: z.string().optional() }) },
  responses: { 200: { description: "A page of audit events.", content: { "application/json": { schema: PageOfAuditEvent } } } },
});

path({
  method: "get",
  path: "/v1/audit/verify",
  tags: ["admin"],
  summary: "Walk the entire audit log and confirm no row was altered or removed.",
  security: [{ adminSession: [] }],
  responses: { 200: { description: "Verification result.", content: { "application/json": { schema: AuditVerifyResult } } } },
});

path({
  method: "get",
  path: "/v1/events",
  tags: ["admin"],
  summary: "Server-Sent Events stream of live pipeline events. Supports Last-Event-ID for reconnect; sends a `: heartbeat` comment every 15s.",
  security: [{ adminSession: [] }],
  request: { headers: z.object({ "Last-Event-ID": z.string().optional() }) },
  responses: { 200: { description: "text/event-stream of TollgateEvent.", content: { "text/event-stream": { schema: z.string() } } } },
});

path({
  method: "get",
  path: "/v1/stats/overview",
  tags: ["admin"],
  summary: "Dashboard summary tiles: today's verdict counts, money protected, pending approvals, 24h hourly series.",
  security: [{ adminSession: [] }],
  responses: { 200: { description: "Stats overview.", content: { "application/json": { schema: StatsOverview } } } },
});

// ---- Token-auth (one-time approval links) ----
path({
  method: "get",
  path: "/v1/approval-links/{token}",
  tags: ["approval-links"],
  summary: "View a pending approval via its one-time, HMAC-signed, 15-minute-expiry link.",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: { description: "What the mobile approval page shows.", content: { "application/json": { schema: ApprovalLinkView } } },
    410: errorResponse("Token expired or already used."),
  },
});

path({
  method: "post",
  path: "/v1/approval-links/{token}",
  tags: ["approval-links"],
  summary: "Approve or deny via the one-time link. The token is consumed on first use either way.",
  request: {
    params: z.object({ token: z.string() }),
    body: { content: { "application/json": { schema: z.object({ decision: z.enum(["approve", "deny"]) }) } } },
  },
  responses: {
    200: { description: "The resolved approval.", content: { "application/json": { schema: ApprovalRequest } } },
    410: errorResponse("Token expired or already used."),
  },
});

// ---- Public ----
path({
  method: "post",
  path: "/webhooks/paypal",
  tags: ["public"],
  summary: "PayPal webhook receiver. Verifies signature, dedupes by PayPal event id.",
  responses: { 200: { description: "Acknowledged." }, 400: errorResponse("Invalid signature.") },
});

path({ method: "get", path: "/healthz", tags: ["public"], summary: "Liveness probe.", responses: { 200: { description: "OK." } } });
path({
  method: "get",
  path: "/readyz",
  tags: ["public"],
  summary: "Readiness probe (DB + LLM reachability).",
  responses: { 200: { description: "Ready." }, 503: errorResponse("Not ready.") },
});
