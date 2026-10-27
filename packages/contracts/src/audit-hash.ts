import { createHash } from "node:crypto";
import type { AuditEvent, AuditVerifyResult } from "./audit.js";

/**
 * Node-only. Not re-exported from the package root (`.`) so the dashboard's
 * browser bundle never pulls in `node:crypto` — import from
 * `@tollgate/contracts/audit-hash` instead.
 */

/** Deterministic JSON: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export const AUDIT_GENESIS_HASH = "0".repeat(64);

/** hash = sha256(prev_hash + canonical_json(payload)), hex-encoded. See docs/ARCHITECTURE.md. */
export function computeAuditHash(prevHash: string, payload: unknown): string {
  return createHash("sha256")
    .update(prevHash + canonicalJson(payload))
    .digest("hex");
}

/** Walks the chain in order and confirms every row's hash matches prev_hash + payload. */
export function verifyAuditChain(events: AuditEvent[]): AuditVerifyResult {
  let prevHash = AUDIT_GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.prev_hash !== prevHash || event.hash !== computeAuditHash(event.prev_hash, event.payload)) {
      return { ok: false, checked: i, first_bad_seq: event.seq };
    }
    prevHash = event.hash;
  }
  return { ok: true, checked: events.length };
}
