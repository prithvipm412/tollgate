import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { PayPalError } from "@tollgate/paypal";
import { ApiErrorSchema } from "@tollgate/contracts";
import { z } from "zod";
import { registerRoutes } from "./routes.js";
import type { GatewayService } from "./service.js";
import type { Config } from "./config.js";
import { errorStatus, GatewayError } from "./errors.js";
export { loadConfig, ConfigError } from "./config.js";
export { GatewayError } from "./errors.js";
export interface AuthAgent {
  id: string;
  status: "active" | "frozen";
}
export interface GatewayStore {
  ping(): Promise<unknown>;
  findAgentByKeyHash(hash: string): Promise<AuthAgent | undefined>;
  close(): Promise<void>;
}
declare module "fastify" {
  interface FastifyRequest {
    agent: AuthAgent | null;
  }
  interface FastifyInstance {
    authenticateAgent(request: FastifyRequest): Promise<void>;
    authenticateAdmin(request: FastifyRequest): Promise<void>;
  }
}
export const hashApiKey = (key: string): string => createHash("sha256").update(key).digest("hex");
const equal = (a: string, b: string): boolean =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function buildGateway(config: Config, store: GatewayStore, service?: GatewayService) {
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: 2048 } });
  const signature = (payload: string) =>
    createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");
  app.decorateRequest("agent", null);
  app.decorate("authenticateAgent", async (request: FastifyRequest) => {
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "");
    const agent = match?.[1] ? await store.findAgentByKeyHash(hashApiKey(match[1])) : undefined;
    if (!agent) throw new GatewayError("UNAUTHORIZED", "Valid agent key required");
    if (agent.status === "frozen") throw new GatewayError("AGENT_FROZEN", "Agent is frozen");
    request.agent = agent;
  });
  app.decorate("authenticateAdmin", async (request: FastifyRequest) => {
    const cookie = request.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("tg_session="))
      ?.slice(11);
    const [expires, mac] = cookie?.split(".") ?? [];
    if (
      !expires ||
      !mac ||
      !/^\d+$/.test(expires) ||
      Number(expires) <= Date.now() ||
      !equal(mac, signature(expires))
    ) {
      throw new GatewayError("UNAUTHORIZED", "Admin session required");
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const mapped =
      error instanceof GatewayError
        ? error
        : error instanceof PayPalError
          ? new GatewayError("PAYPAL_ERROR", "PayPal request failed")
          : error instanceof z.ZodError ||
              (error instanceof Error &&
                "statusCode" in error &&
                (error.statusCode === 400 || error.statusCode === 415))
            ? new GatewayError("VALIDATION_ERROR", "Invalid request")
            : new GatewayError("INTERNAL_ERROR", "Internal server error");
    reply.code(errorStatus[mapped.code]).send(
      ApiErrorSchema.parse({
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      }),
    );
  });
  app.setNotFoundHandler(() => {
    throw new GatewayError("NOT_FOUND", "Route not found");
  });
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await store.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.post("/v1/auth/login", async (request, reply) => {
    const { password } = z.object({ password: z.string() }).parse(request.body);
    if (!equal(password, config.ADMIN_PASSWORD))
      throw new GatewayError("UNAUTHORIZED", "Invalid password");
    const expires = String(Date.now() + 8 * 60 * 60 * 1000);
    const secure = config.PUBLIC_BASE_URL.startsWith("https:") ? "; Secure" : "";
    reply.header(
      "Set-Cookie",
      `tg_session=${expires}.${signature(expires)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${secure}`,
    );
    return { ok: true };
  });
  if (service) registerRoutes(app, service);
  app.addHook("onClose", async () => {
    await store.close();
  });
  return app;
}
