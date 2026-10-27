import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@tollgate/contracts";
import { buildGateway, ConfigError, GatewayError, hashApiKey, loadConfig } from "./index.js";
import type { GatewayStore } from "./index.js";
import { PayPalError } from "@tollgate/paypal";
const env = {
  PAYPAL_CLIENT_ID: "id",
  PAYPAL_CLIENT_SECRET: "secret",
  PAYPAL_ENV: "sandbox",
  PAYPAL_WEBHOOK_ID: "webhook",
  DATABASE_URL: "postgres://localhost/test",
  LLM_BASE_URL: "http://localhost:11434/v1",
  LLM_API_KEY: "key",
  LLM_MODEL: "model",
  NTFY_SERVER: "https://ntfy.sh",
  NTFY_TOPIC: "topic",
  ADMIN_PASSWORD: "password",
  SESSION_SECRET: "s".repeat(32),
  APPROVAL_TOKEN_SECRET: "a".repeat(32),
  PUBLIC_BASE_URL: "https://gateway.example.com",
  DASHBOARD_URL: "https://dashboard.example.com",
};
const store = (): GatewayStore => ({
  ping: vi.fn(async () => {}),
  findAgentByKeyHash: vi.fn(async (hash) =>
    hash === hashApiKey("valid")
      ? { id: "agent", status: "active" as const }
      : hash === hashApiKey("frozen")
        ? { id: "agent", status: "frozen" as const }
        : undefined,
  ),
  close: vi.fn(async () => {}),
});
const apps: ReturnType<typeof buildGateway>[] = [];
const setup = () => {
  const db = store();
  const app = buildGateway(loadConfig(env), db);
  apps.push(app);
  return { app, db };
};
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe("configuration", () => {
  it("accepts a complete environment", () => {
    expect(loadConfig(env)).toEqual(env);
  });
  it("lists every missing variable in one typed error without secret values", () => {
    try {
      loadConfig({});
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      for (const key of Object.keys(env)) expect((error as Error).message).toContain(key);
    }
  });
  it.each(Object.keys(env))("requires %s", (key) => {
    expect(() => loadConfig({ ...env, [key]: "" })).toThrow(ConfigError);
  });
  it("rejects live mode, short secrets, and invalid URL protocols", () => {
    expect(() =>
      loadConfig({
        ...env,
        PAYPAL_ENV: "live",
        SESSION_SECRET: "short",
        DATABASE_URL: "https://db",
        NTFY_SERVER: "ftp://ntfy",
      }),
    ).toThrow(ConfigError);
  });
});
describe("gateway", () => {
  it("keeps liveness independent from database readiness", async () => {
    const { app, db } = setup();
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/readyz")).statusCode).toBe(200);
    vi.mocked(db.ping).mockRejectedValue(new Error("offline"));
    expect((await app.inject("/readyz")).statusCode).toBe(503);
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    await app.close();
    expect(db.close).toHaveBeenCalled();
  });
  it.each([
    [undefined, 401],
    ["Bearer invalid", 401],
    ["Basic valid", 401],
    ["Bearer frozen", 403],
    ["Bearer valid", 200],
  ] as const)("authenticates %s", async (authorization, status) => {
    const { app, db } = setup();
    app.get("/agent-test", { preHandler: app.authenticateAgent }, async (request) => request.agent);
    const response = await app.inject({
      url: "/agent-test",
      headers: authorization ? { authorization } : {},
    });
    expect(response.statusCode).toBe(status);
    if (authorization === "Bearer valid")
      expect(db.findAgentByKeyHash).toHaveBeenCalledWith(hashApiKey("valid"));
    if (status !== 200)
      expect(response.json().code).toBe(status === 403 ? "AGENT_FROZEN" : "UNAUTHORIZED");
  });
  it("requires a signed, unexpired admin cookie", async () => {
    const { app } = setup();
    app.get("/admin-test", { preHandler: app.authenticateAdmin }, async () => ({ ok: true }));
    expect((await app.inject("/admin-test")).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { password: "wrong" } }))
        .statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { password: env.ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect((await app.inject({ url: "/admin-test", headers: { cookie } })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: "/admin-test",
          headers: { cookie: cookie.replace("tg_session=", "tg_session=0") },
        })
      ).statusCode,
    ).toBe(401);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 9 * 60 * 60 * 1000);
    expect((await app.inject({ url: "/admin-test", headers: { cookie } })).statusCode).toBe(401);
    vi.restoreAllMocks();
  });
  it.each([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["AGENT_FROZEN", 403],
    ["KILL_SWITCH_ENGAGED", 403],
    ["VALIDATION_ERROR", 400],
    ["NOT_FOUND", 404],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["RATE_LIMITED", 429],
    ["APPROVAL_EXPIRED", 410],
    ["APPROVAL_ALREADY_RESOLVED", 409],
    ["INVALID_TOKEN", 410],
    ["PAYPAL_ERROR", 502],
    ["INTERNAL_ERROR", 500],
  ] as const)("maps %s to HTTP %s", async (code, status) => {
    const { app } = setup();
    app.get("/error", async () => {
      throw new GatewayError(code, "Test error");
    });
    const response = await app.inject("/error");
    expect(response.statusCode).toBe(status);
    expect(ApiErrorSchema.parse(response.json())).toEqual({ code, message: "Test error" });
  });
  it("sanitizes unknown failures and maps malformed JSON and missing routes", async () => {
    const { app } = setup();
    app.get("/paypal-error", async () => {
      throw new PayPalError("upstream secret", 422);
    });
    app.get("/error", async () => {
      throw new Error("database password");
    });
    expect((await app.inject("/paypal-error")).statusCode).toBe(502);
    const response = await app.inject("/error");
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("database password");
    expect((await app.inject("/missing")).json().code).toBe("NOT_FOUND");
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(malformed.json()).code).toBe("VALIDATION_ERROR");
  });
});
