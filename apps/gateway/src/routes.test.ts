import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentCreateResponseSchema,
  AgentSchema,
  PolicyCompileResponseSchema,
  MandateSchema,
  TollgateEventSchema,
  pageSchema,
  ActionRecordSchema,
  AuditEventSchema,
} from "@tollgate/contracts";
import { buildGateway, hashApiKey } from "./index.js";
import { config, request, setup } from "./test-support.js";
import { page } from "./routes.js";
const apps: ReturnType<typeof buildGateway>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function appSetup() {
  const context = await setup();
  const app = buildGateway(
    config,
    {
      ping: async () => {},
      findAgentByKeyHash: async (hash) =>
        [...context.store.state.agents.values()].find((a) => a.key_hash === hash),
      close: async () => {},
    },
    context.service,
  );
  apps.push(app);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { password: config.ADMIN_PASSWORD },
  });
  return {
    ...context,
    app,
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    authorization: `Bearer ${context.agent.api_key}`,
  };
}
describe("M2 routes", () => {
  it("requires admin auth on operator endpoints and validates agent input", async () => {
    const { app, authorization } = await appSetup();
    for (const url of [
      "/v1/actions",
      "/v1/approvals",
      "/v1/agents",
      "/v1/killswitch",
      "/v1/audit",
      "/v1/audit/verify",
      "/v1/events",
    ])
      expect((await app.inject(url)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/actions",
          headers: { authorization },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/v1/actions", payload: request() })).statusCode,
    ).toBe(401);
  });
  it("serves contract-shaped actions, filtered pages, limits and audit verification", async () => {
    const { app, authorization, cookie, agent } = await appSetup();
    const r = request();
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization },
      payload: r,
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe("executed");
    expect(
      (await app.inject({ url: `/v1/actions/${r.action_id}`, headers: { authorization } })).json(),
    ).toEqual(submitted.json());
    expect(
      (await app.inject({ url: `/v1/actions/${r.action_id}`, headers: { cookie } })).json(),
    ).toEqual(submitted.json());
    const list = await app.inject({
      url: `/v1/actions?agent_id=${agent.id}&status=executed`,
      headers: { cookie },
    });
    expect(pageSchema(ActionRecordSchema).parse(list.json()).items).toHaveLength(1);
    expect(
      (await app.inject({ url: "/v1/actions?status=blocked", headers: { cookie } })).json().items,
    ).toHaveLength(0);
    expect(
      (await app.inject({ url: "/v1/me/limits", headers: { authorization } })).json().daily
        .used_cents,
    ).toBe(2500);
    expect(
      pageSchema(AuditEventSchema).parse(
        (await app.inject({ url: "/v1/audit", headers: { cookie } })).json(),
      ).items.length,
    ).toBeGreaterThan(0);
    expect((await app.inject({ url: "/v1/audit/verify", headers: { cookie } })).json().ok).toBe(
      true,
    );
    expect(
      (await app.inject({ url: "/v1/actions?cursor=invalid", headers: { cookie } })).statusCode,
    ).toBe(400);
  });
  it("creates agents, compiles/confirms mandates, rotates keys, and enforces the switch", async () => {
    const { app, cookie, authorization, agent } = await appSetup();
    const headers = { cookie };
    const created = AgentCreateResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/agents",
          headers,
          payload: { name: "New bot" },
        })
      ).json(),
    );
    const publicAgents = (await app.inject({ url: "/v1/agents", headers })).json().items;
    expect(publicAgents.find((a: { id: string }) => a.id === created.id)).not.toHaveProperty(
      "api_key",
    );
    expect(JSON.stringify(publicAgents)).not.toContain("key_hash");
    const compiled = PolicyCompileResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/mandates/compile",
          headers,
          payload: { instruction: "Only pay contractors" },
        })
      ).json(),
    );
    const confirmed = MandateSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/v1/mandates",
          headers,
          payload: {
            agent_id: created.id,
            instruction: "Only pay contractors",
            policy: compiled.policy,
          },
        })
      ).json(),
    );
    expect(confirmed.version).toBe(1);
    expect((await app.inject({ url: `/v1/agents/${created.id}/mandate`, headers })).json()).toEqual(
      confirmed,
    );
    expect(
      AgentSchema.parse(
        (
          await app.inject({ method: "POST", url: `/v1/agents/${agent.id}/freeze`, headers })
        ).json(),
      ).status,
    ).toBe("frozen");
    expect(
      (await app.inject({ url: "/v1/me/limits", headers: { authorization } })).statusCode,
    ).toBe(403);
    await app.inject({ method: "POST", url: `/v1/agents/${agent.id}/unfreeze`, headers });
    const rotated = AgentCreateResponseSchema.parse(
      (
        await app.inject({ method: "POST", url: `/v1/agents/${agent.id}/rotate-key`, headers })
      ).json(),
    );
    expect(hashApiKey(rotated.api_key)).not.toBe(hashApiKey(agent.api_key));
    expect(
      (await app.inject({ url: "/v1/me/limits", headers: { authorization } })).statusCode,
    ).toBe(401);
    await app.inject({
      method: "POST",
      url: "/v1/killswitch",
      headers,
      payload: { engaged: true, reason: "Stop" },
    });
    expect((await app.inject({ url: "/v1/killswitch", headers })).json().engaged).toBe(true);
    const response = await app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization: `Bearer ${rotated.api_key}` },
      payload: request(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("KILL_SWITCH_ENGAGED");
  });
  it("resolves holds through the public one-time link and admin endpoints", async () => {
    const { app, agent, cookie, authorization, evaluatePolicy, notify } = await appSetup();
    evaluatePolicy.mockReturnValue({ verdict: "hold", findings: [] });
    const r = request();
    await app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization },
      payload: r,
    });
    const token = notify.mock.calls[0]![0].split("/").at(-1)!;
    expect((await app.inject(`/v1/approval-links/${token}`)).json().action_id).toBe(r.action_id);
    expect(
      (await app.inject({ url: "/v1/approvals?status=pending", headers: { cookie } })).json().items,
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/approval-links/${token}`,
          payload: { decision: "deny" },
        })
      ).json().status,
    ).toBe("denied");
    const reused = await app.inject({
      method: "POST",
      url: `/v1/approval-links/${token}`,
      payload: { decision: "approve" },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe("APPROVAL_ALREADY_RESOLVED");
    const next = await app.inject({
      method: "POST",
      url: "/v1/actions",
      headers: { authorization },
      payload: request(),
    });
    const approvals = await app.inject({
      url: "/v1/approvals?status=pending",
      headers: { cookie },
    });
    const id = approvals.json().items[0].id;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/approvals/${id}/approve`,
      headers: { cookie },
    });
    expect(approved.json()).toMatchObject({ status: "approved", decided_via: "dashboard" });
    expect(
      (
        await app.inject({
          url: `/v1/actions/${next.json().request.action_id}`,
          headers: { authorization },
        })
      ).json().status,
    ).toBe("executed");
    expect(agent.id).toBe(next.json().agent_id);
  });
  it("replays persisted SSE snapshots in lifecycle order and sends heartbeats", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { app, service, agent, cookie } = await appSetup();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/v1/events`, {
      headers: { cookie, "Last-Event-ID": "0" },
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) {
        const next = await reader.read();
        if (next.done) throw new Error("SSE ended");
        text += decoder.decode(next.value);
      }
    };
    try {
      await readUntil(": connected");
      await service.submit(agent.id, request());
      await vi.advanceTimersByTimeAsync(250);
      await readUntil("action.executed");
      const events = text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => TollgateEventSchema.parse(JSON.parse(line.slice(6))));
      expect(events.map((e) => e.type)).toEqual([
        "action.received",
        "action.decided",
        "action.executed",
      ]);
      expect(events[0]!.payload).toHaveProperty("status", "received");
      for (const event of events) expect(text).toContain(`id: ${event.id}\n`);
      await vi.advanceTimersByTimeAsync(15_000);
      await readUntil(": heartbeat");
      const replay = await service.eventsAfter(Number(events[0]!.id));
      expect(replay.map((e) => e.type)).toEqual(["action.decided", "action.executed"]);
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
  it("runs the expiry job and closes its timers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { app, service, agent, store, evaluatePolicy } = await appSetup();
    evaluatePolicy.mockReturnValue({ verdict: "hold", findings: [] });
    const r = request();
    await service.submit(agent.id, r);
    await vi.advanceTimersByTimeAsync(910_000);
    expect(store.state.actions.get(r.action_id)?.status).toBe("expired");
    await app.close();
  });
  it("uses stable keyset cursors across page boundaries", () => {
    const items = Array.from({ length: 52 }, (_, id) => ({ id }));
    const first = page(items, undefined, (a) => a.id);
    expect(first.items).toHaveLength(50);
    expect(first.next_cursor).not.toBeNull();
    expect(page(items, first.next_cursor!, (a) => a.id)).toEqual({
      items: [{ id: 50 }, { id: 51 }],
      next_cursor: null,
    });
  });
});
