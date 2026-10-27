import { describe, expect, it } from "vitest";
import { deriveMcpActionId, uuidV5 } from "./mcp-idempotency.js";

describe("uuidV5", () => {
  it("matches the standard DNS-namespace test vector", () => {
    // python: uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.org")
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.org")).toBe("74738ff5-5367-5958-9aee-98fffdcd1876");
  });

  it("sets the version and variant nibbles", () => {
    const id = uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "anything");
    expect(id[14]).toBe("5");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "same")).toBe(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "same"));
  });
});

describe("deriveMcpActionId", () => {
  it("is deterministic per (agent, idempotency_key)", () => {
    const a = deriveMcpActionId("agent-1", "my-key");
    const b = deriveMcpActionId("agent-1", "my-key");
    expect(a).toBe(b);
  });

  it("differs across agents for the same key, and across keys for the same agent", () => {
    const base = deriveMcpActionId("agent-1", "my-key");
    expect(deriveMcpActionId("agent-2", "my-key")).not.toBe(base);
    expect(deriveMcpActionId("agent-1", "other-key")).not.toBe(base);
  });
});
