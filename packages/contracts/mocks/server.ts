/**
 * Tiny mock server for `apps/dashboard` to build against before the real
 * gateway exists. Serves the REST API + SSE straight from fixtures, with an
 * in-memory store seeded from them so admin mutations (approve/deny,
 * freeze/unfreeze, kill switch) are visible on the next GET. No real auth:
 * any Bearer token is accepted as an agent key, any password logs in as
 * admin (see addendum 4 in docs/CONTRACT.md's history).
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActionRecord, ApprovalRequest, Agent, AgentCreateResponse, KillSwitchState, Page, TollgateEvent } from "../src/index.js";
import {
  agents as fixtureAgents,
  actions as fixtureActions,
  approvals as fixtureApprovals,
  approvalLinkView,
  auditEvents,
  auditVerifyResult,
  statsOverview,
  limitsResponse,
  killSwitchDisengaged,
  mandate,
  policyCompileResponse,
  APPROVAL_LINK_TOKEN,
} from "../fixtures/index.js";

const PORT = 4010;

// ---- in-memory state, seeded from fixtures ----
const agents = new Map<string, Agent>(fixtureAgents.map((a) => [a.id, a]));
const actions = new Map<string, ActionRecord>(fixtureActions.map((a) => [a.request.action_id, a]));
const approvals = new Map<string, ApprovalRequest>(fixtureApprovals.map((a) => [a.id, a]));
let killSwitch: KillSwitchState = killSwitchDisengaged;
const usedApprovalLinkTokens = new Set<string>();

let eventSeq = 0;
const sseClients = new Set<ServerResponse>();

function nextEventId(): string {
  eventSeq += 1;
  return String(eventSeq);
}

function broadcast(event: Omit<TollgateEvent, "id">) {
  const full = { ...event, id: nextEventId() } as TollgateEvent;
  const data = `id: ${full.id}\nevent: ${full.type}\ndata: ${JSON.stringify(full)}\n\n`;
  for (const client of sseClients) client.write(data);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string) {
  sendJson(res, status, { code, message });
}

function page<T>(items: T[], cursor: string | undefined): Page<T> {
  // Demo-sized collections: no real pagination, always one page.
  void cursor;
  return { items, next_cursor: null };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isAgentAuthed(req: IncomingMessage): boolean {
  return Boolean(req.headers.authorization?.startsWith("Bearer "));
}

function isAdminAuthed(req: IncomingMessage): boolean {
  return Boolean(req.headers.cookie?.includes("tg_session="));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const { pathname } = url;
  const method = req.method ?? "GET";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  try {
    // Public
    if (pathname === "/healthz" || pathname === "/readyz") return sendJson(res, 200, { ok: true });

    if (pathname === "/webhooks/paypal" && method === "POST") {
      await readJsonBody(req);
      return sendJson(res, 200, { received: true });
    }

    // Auth
    if (pathname === "/v1/auth/login" && method === "POST") {
      await readJsonBody(req); // any password accepted in the mock
      res.setHeader("Set-Cookie", "tg_session=mock; HttpOnly; Path=/");
      return sendJson(res, 200, { ok: true });
    }

    // Agent-auth: submit action
    if (pathname === "/v1/actions" && method === "POST") {
      if (!isAgentAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Missing agent key.");
      if (killSwitch.engaged) return sendError(res, 403, "KILL_SWITCH_ENGAGED", "The kill switch is engaged; no actions are accepted.");
      const request = (await readJsonBody(req)) as ActionRecord["request"];
      const amountCents = Number(request.amount.value.replace(".", ""));
      const now = new Date().toISOString();
      const held = amountCents > 30000;
      const record: ActionRecord = {
        request,
        agent_id: fixtureAgents[0]!.id,
        decision: {
          verdict: held ? "hold" : "allow",
          risk_score: held ? 50 : 10,
          findings: held
            ? [{ source: "policy", code: "AMOUNT_ABOVE_THRESHOLD", severity: "hold", message: "Amount exceeds the $300 approval threshold." }]
            : [{ source: "policy", code: "WITHIN_LIMITS", severity: "info", message: "Within policy limits." }],
          policy_version: 1,
          decided_at: now,
        },
        status: held ? "pending_approval" : "executed",
        paypal_resource_id: held ? undefined : `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`,
        created_at: now,
        updated_at: now,
      };
      actions.set(request.action_id, record);
      broadcast({ type: "action.received", payload: record });
      broadcast({ type: "action.decided", payload: record });
      if (held) {
        const approval: ApprovalRequest = {
          id: randomUUID(),
          action_id: request.action_id,
          status: "pending",
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
        approvals.set(approval.id, approval);
        broadcast({ type: "approval.created", payload: approval });
      } else {
        broadcast({ type: "action.executed", payload: record });
      }
      return sendJson(res, 200, record);
    }

    const actionMatch = pathname.match(/^\/v1\/actions\/([^/]+)$/);
    if (actionMatch && method === "GET") {
      if (!isAgentAuthed(req) && !isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Agent key or admin session required.");
      const record = actions.get(actionMatch[1]!);
      if (!record) return sendError(res, 404, "NOT_FOUND", "No action with that id.");
      return sendJson(res, 200, record);
    }

    if (pathname === "/v1/actions" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const status = url.searchParams.get("status");
      const agentId = url.searchParams.get("agent_id");
      let items = [...actions.values()];
      if (status) items = items.filter((a) => a.status === status);
      if (agentId) items = items.filter((a) => a.agent_id === agentId);
      return sendJson(res, 200, page(items, url.searchParams.get("cursor") ?? undefined));
    }

    if (pathname === "/v1/me/limits" && method === "GET") {
      if (!isAgentAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Missing agent key.");
      return sendJson(res, 200, limitsResponse);
    }

    if (pathname === "/v1/approvals" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const status = url.searchParams.get("status");
      let items = [...approvals.values()];
      if (status) items = items.filter((a) => a.status === status);
      return sendJson(res, 200, page(items, url.searchParams.get("cursor") ?? undefined));
    }

    const approvalDecisionMatch = pathname.match(/^\/v1\/approvals\/([^/]+)\/(approve|deny)$/);
    if (approvalDecisionMatch && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const [, id, decision] = approvalDecisionMatch;
      const approval = approvals.get(id!);
      if (!approval) return sendError(res, 404, "NOT_FOUND", "No approval with that id.");
      if (approval.status !== "pending") return sendError(res, 409, "APPROVAL_ALREADY_RESOLVED", "Already resolved or expired.");
      const resolved: ApprovalRequest = {
        ...approval,
        status: decision === "approve" ? "approved" : "denied",
        decided_at: new Date().toISOString(),
        decided_via: "dashboard",
      };
      approvals.set(id!, resolved);
      const action = actions.get(approval.action_id);
      if (action) {
        const updated: ActionRecord = { ...action, status: decision === "approve" ? "executed" : "denied", updated_at: new Date().toISOString() };
        actions.set(approval.action_id, updated);
        broadcast({ type: "action.executed", payload: updated });
      }
      broadcast({ type: "approval.resolved", payload: resolved });
      return sendJson(res, 200, resolved);
    }

    if (pathname === "/v1/agents" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, page([...agents.values()], undefined));
    }

    if (pathname === "/v1/agents" && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const body = (await readJsonBody(req)) as { name: string };
      const agent: Agent = {
        id: randomUUID(),
        name: body.name,
        status: "active",
        key_prefix: `tg_${randomUUID().slice(0, 6)}`,
        created_at: new Date().toISOString(),
        last_seen_at: null,
      };
      agents.set(agent.id, agent);
      const response: AgentCreateResponse = { ...agent, api_key: `${agent.key_prefix}_${randomUUID().replace(/-/g, "")}` };
      return sendJson(res, 200, response);
    }

    const agentActionMatch = pathname.match(/^\/v1\/agents\/([^/]+)\/(freeze|unfreeze|rotate-key)$/);
    if (agentActionMatch && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const [, id, action] = agentActionMatch;
      const agent = agents.get(id!);
      if (!agent) return sendError(res, 404, "NOT_FOUND", "No agent with that id.");
      if (action === "rotate-key") {
        const response: AgentCreateResponse = { ...agent, api_key: `${agent.key_prefix}_${randomUUID().replace(/-/g, "")}` };
        return sendJson(res, 200, response);
      }
      const updated: Agent = { ...agent, status: action === "freeze" ? "frozen" : "active" };
      agents.set(id!, updated);
      broadcast({ type: "agent.frozen", payload: updated });
      return sendJson(res, 200, updated);
    }

    if (pathname === "/v1/mandates/compile" && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      await readJsonBody(req);
      return sendJson(res, 200, policyCompileResponse);
    }

    if (pathname === "/v1/mandates" && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      await readJsonBody(req);
      return sendJson(res, 200, mandate);
    }

    const agentMandateMatch = pathname.match(/^\/v1\/agents\/([^/]+)\/mandate$/);
    if (agentMandateMatch && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, mandate);
    }

    if (pathname === "/v1/killswitch" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, killSwitch);
    }

    if (pathname === "/v1/killswitch" && method === "POST") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      const body = (await readJsonBody(req)) as { engaged: boolean; reason?: string };
      killSwitch = { engaged: body.engaged, engaged_at: body.engaged ? new Date().toISOString() : undefined, reason: body.reason };
      broadcast({ type: "killswitch.changed", payload: killSwitch });
      return sendJson(res, 200, killSwitch);
    }

    if (pathname === "/v1/audit" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, page(auditEvents, undefined));
    }

    if (pathname === "/v1/audit/verify" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, auditVerifyResult);
    }

    if (pathname === "/v1/stats/overview" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      return sendJson(res, 200, statsOverview);
    }

    if (pathname === "/v1/events" && method === "GET") {
      if (!isAdminAuthed(req)) return sendError(res, 401, "UNAUTHORIZED", "Admin session required.");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Last-Event-ID is accepted but the mock has no backlog to replay from — it just resumes the live stream.
      void req.headers["last-event-id"];
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    const approvalLinkMatch = pathname.match(/^\/v1\/approval-links\/([^/]+)$/);
    if (approvalLinkMatch) {
      const token = approvalLinkMatch[1]!;
      if (token !== APPROVAL_LINK_TOKEN || usedApprovalLinkTokens.has(token)) {
        return sendError(res, 410, "INVALID_TOKEN", "Token expired or already used.");
      }
      if (method === "GET") return sendJson(res, 200, approvalLinkView);
      if (method === "POST") {
        const body = (await readJsonBody(req)) as { decision: "approve" | "deny" };
        usedApprovalLinkTokens.add(token);
        const approval = approvals.get(approvalLinkView.approval_id);
        if (approval) {
          const resolved: ApprovalRequest = {
            ...approval,
            status: body.decision === "approve" ? "approved" : "denied",
            decided_at: new Date().toISOString(),
            decided_via: "link",
          };
          approvals.set(approval.id, resolved);
          broadcast({ type: "approval.resolved", payload: resolved });
          return sendJson(res, 200, resolved);
        }
      }
    }

    sendError(res, 404, "NOT_FOUND", `No route for ${method} ${pathname}`);
  } catch (err) {
    sendError(res, 500, "INTERNAL_ERROR", err instanceof Error ? err.message : "Unknown error");
  }
});

setInterval(() => {
  const heartbeat = ": heartbeat\n\n";
  for (const client of sseClients) client.write(heartbeat);
}, 15_000);

// Emit a fake event every few seconds so the dashboard has something to react to even with no real traffic.
setInterval(() => {
  broadcast({ type: "action.decided", payload: fixtureActions[Math.floor(Math.random() * fixtureActions.length)]! });
}, 5_000);

server.listen(PORT, () => {
  console.log(`tollgate mock API listening on http://localhost:${PORT}`);
});
