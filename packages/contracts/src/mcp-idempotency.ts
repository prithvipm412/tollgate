import { createHash } from "node:crypto";

/**
 * Node-only. Not re-exported from the package root (`.`) — see audit-hash.ts
 * for why. Import from `@tollgate/contracts/mcp-idempotency` instead.
 *
 * Fixed namespace for deriving an MCP action_id via
 * UUIDv5(MCP_IDEMPOTENCY_NAMESPACE, `${agent_id}:${idempotency_key}`).
 * Never change this value — changing it silently breaks idempotency for
 * every in-flight retry across a gateway restart or redeploy.
 */
export const MCP_IDEMPOTENCY_NAMESPACE = "dd606f93-180e-4f3f-8aef-fad7aba82f64";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 §4.3 UUIDv5: SHA-1(namespace bytes + name) with version/variant bits set. */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, "utf8")]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  return bytesToUuid(bytes);
}

/**
 * The gateway calls this when an MCP tool call includes `idempotency_key`:
 * action_id is deterministic per (agent, key), so retries with the same key
 * always resolve to the same action instead of creating a new one.
 */
export function deriveMcpActionId(agentId: string, idempotencyKey: string): string {
  return uuidV5(MCP_IDEMPOTENCY_NAMESPACE, `${agentId}:${idempotencyKey}`);
}
