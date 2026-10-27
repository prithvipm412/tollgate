import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import {
  ActionStatusSchema,
  AgentSchema,
  ApprovalRequestSchema,
  ApprovalStatusSchema,
  PaymentActionRequestSchema,
  PolicyCompileRequestSchema,
  PolicyDocumentSchema,
} from "@tollgate/contracts";
import type { Page } from "@tollgate/contracts";
import { GatewayError } from "./errors.js";
import type { GatewayService } from "./service.js";

const idSchema = z.object({ id: z.string().uuid() });
const tokenSchema = z.object({ token: z.string().min(1).max(2048) });
const cursorSchema = z.string().max(256).optional();
export function page<T>(
  items: T[],
  cursor: string | undefined,
  key: (item: T) => string | number,
): Page<T> {
  let after: string | number | undefined;
  if (cursor) {
    try {
      after = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown as string | number;
    } catch {
      throw new GatewayError("VALIDATION_ERROR", "Invalid cursor");
    }
    if (
      (typeof after !== "string" && typeof after !== "number") ||
      (items[0] && typeof after !== typeof key(items[0]))
    )
      throw new GatewayError("VALIDATION_ERROR", "Invalid cursor");
  }
  const sorted = [...items]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .filter((item) => after === undefined || key(item) > after);
  const selected = sorted.slice(0, 50);
  return {
    items: selected,
    next_cursor:
      sorted.length > 50
        ? Buffer.from(JSON.stringify(key(selected.at(-1)!))).toString("base64url")
        : null,
  };
}
export function registerRoutes(app: FastifyInstance, service: GatewayService) {
  const admin = { preHandler: app.authenticateAdmin };
  const agent = { preHandler: app.authenticateAgent };
  app.post("/v1/actions", agent, async (request) =>
    service.submit(request.agent!.id, PaymentActionRequestSchema.parse(request.body)),
  );
  app.get("/v1/actions/:id", async (request) => {
    const { id } = idSchema.parse(request.params);
    if (request.headers.authorization) {
      await app.authenticateAgent(request);
      return service.action(id, request.agent!.id);
    }
    await app.authenticateAdmin(request);
    return service.action(id);
  });
  app.get("/v1/actions", admin, async (request) => {
    const q = z
      .object({
        status: ActionStatusSchema.optional(),
        agent_id: z.string().uuid().optional(),
        cursor: cursorSchema,
      })
      .parse(request.query);
    return service.store.read(async (tx) =>
      page(
        (await tx.actions(q.agent_id)).filter((a) => !q.status || a.status === q.status),
        q.cursor,
        (a) => a.request.action_id,
      ),
    );
  });
  app.get("/v1/me/limits", agent, async (request) => service.limits(request.agent!.id));
  app.get("/v1/approvals", admin, async (request) => {
    const q = z
      .object({ status: ApprovalStatusSchema.optional(), cursor: cursorSchema })
      .parse(request.query);
    return service.store.read(async (tx) =>
      page(
        (await tx.approvals())
          .filter((a) => !q.status || a.status === q.status)
          .map((a) => ApprovalRequestSchema.parse(a)),
        q.cursor,
        (a) => a.id,
      ),
    );
  });
  for (const decision of ["approve", "deny"] as const)
    app.post(`/v1/approvals/:id/${decision}`, admin, async (request) =>
      service.resolveApproval(idSchema.parse(request.params).id, decision, "dashboard"),
    );
  app.get("/v1/approval-links/:token", async (request) =>
    service.approvalLink(tokenSchema.parse(request.params).token),
  );
  app.post("/v1/approval-links/:token", async (request) =>
    service.resolveApproval(
      tokenSchema.parse(request.params).token,
      z.object({ decision: z.enum(["approve", "deny"]) }).parse(request.body).decision,
      "link",
    ),
  );
  app.get("/v1/killswitch", admin, async () => service.store.read((tx) => tx.killSwitch()));
  app.post("/v1/killswitch", admin, async (request) =>
    service.setKillSwitch(
      z
        .object({ engaged: z.boolean(), reason: z.string().max(1000).optional() })
        .parse(request.body),
    ),
  );
  app.get("/v1/audit", admin, async (request) => {
    const { cursor } = z.object({ cursor: cursorSchema }).parse(request.query);
    return service.store.read(async (tx) => page(await tx.audit(), cursor, (e) => e.seq));
  });
  app.get("/v1/audit/verify", admin, async () => service.verifyAudit());
  app.get("/v1/agents", admin, async (request) => {
    const { cursor } = z.object({ cursor: cursorSchema }).parse(request.query);
    return service.store.read(async (tx) =>
      page(
        (await tx.agents()).map((a) => AgentSchema.parse(a)),
        cursor,
        (a) => a.id,
      ),
    );
  });
  app.post("/v1/agents", admin, async (request) =>
    service.createAgent(
      z.object({ name: z.string().trim().min(1).max(200) }).parse(request.body).name,
    ),
  );
  for (const operation of ["freeze", "unfreeze", "rotate-key"] as const)
    app.post(`/v1/agents/:id/${operation}`, admin, async (request) =>
      service.updateAgent(idSchema.parse(request.params).id, operation),
    );
  app.post("/v1/mandates/compile", admin, async (request) =>
    service.compile(PolicyCompileRequestSchema.parse(request.body).instruction),
  );
  app.post("/v1/mandates", admin, async (request) =>
    service.confirmMandate(
      z
        .object({
          agent_id: z.string().uuid(),
          instruction: z.string().min(1).max(4000),
          policy: PolicyDocumentSchema,
        })
        .parse(request.body),
    ),
  );
  app.get("/v1/agents/:id/mandate", admin, async (request) =>
    service.store.read(async (tx) => {
      const mandate = await tx.mandate(idSchema.parse(request.params).id);
      if (!mandate) throw new GatewayError("NOT_FOUND", "No confirmed mandate exists");
      return mandate;
    }),
  );

  const clients = new Set<ServerResponse>();
  app.get("/v1/events", admin, async (request, reply) => {
    const header = request.headers["last-event-id"];
    if (
      header &&
      (Array.isArray(header) || !/^\d+$/.test(header) || !Number.isSafeInteger(Number(header)))
    )
      throw new GatewayError("VALIDATION_ERROR", "Invalid Last-Event-ID");
    // Capture the initial head before handing over the stream. A subsequent poll
    // includes all commits after this point, so replay/live handoff has no gap.
    let after = header
      ? Number(header)
      : await service.store.read(async (tx) => (await tx.auditHead())?.seq ?? 0);
    reply.hijack();
    const raw = reply.raw;
    clients.add(raw);
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write(": connected\n\n");
    let polling = false;
    const poll = async () => {
      if (polling || raw.destroyed) return;
      polling = true;
      try {
        for (const event of await service.eventsAfter(after)) {
          if (raw.destroyed) break;
          // Disconnect a slow consumer instead of buffering unbounded data. Its
          // last received ID lets it replay the persisted events on reconnect.
          const accepted = raw.write(
            `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          if (!accepted) {
            raw.destroy();
            break;
          }
          after = Number(event.id);
        }
      } catch {
        raw.destroy();
      } finally {
        polling = false;
      }
    };
    const events = setInterval(() => {
      void poll();
    }, 250);
    const heartbeat = setInterval(() => {
      if (!raw.write(": heartbeat\n\n")) raw.destroy();
    }, 15_000);
    events.unref();
    heartbeat.unref();
    raw.on("close", () => {
      clearInterval(events);
      clearInterval(heartbeat);
      clients.delete(raw);
    });
    void poll();
  });
  let expiring = false;
  const expiry = setInterval(() => {
    if (expiring) return;
    expiring = true;
    void service
      .expireApprovals()
      .catch((error) => app.log.error(error, "Approval expiry failed"))
      .finally(() => {
        expiring = false;
      });
  }, 10_000);
  expiry.unref();
  app.addHook("preClose", async () => {
    clearInterval(expiry);
    for (const client of clients) client.end();
  });
}
