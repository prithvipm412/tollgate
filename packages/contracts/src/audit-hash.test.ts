import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS_HASH, canonicalJson, computeAuditHash, verifyAuditChain } from "./audit-hash.js";
import type { AuditEvent } from "./audit.js";

describe("canonicalJson", () => {
  it("is insensitive to key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("preserves array order", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });
});

function buildChain(payloads: Record<string, unknown>[]): AuditEvent[] {
  let prevHash = AUDIT_GENESIS_HASH;
  return payloads.map((payload, i) => {
    const hash = computeAuditHash(prevHash, payload);
    const event: AuditEvent = { seq: i, ts: new Date().toISOString(), type: "test", payload, prev_hash: prevHash, hash };
    prevHash = hash;
    return event;
  });
}

describe("verifyAuditChain", () => {
  it("verifies a correctly built chain", () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(verifyAuditChain(chain)).toEqual({ ok: true, checked: 3 });
  });

  it("detects a tampered payload", () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }, { c: 3 }]);
    chain[1]!.payload = { b: 999 };
    expect(verifyAuditChain(chain)).toEqual({ ok: false, checked: 1, first_bad_seq: 1 });
  });

  it("detects a row deleted from the middle of the chain", () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }, { c: 3 }]);
    chain.splice(1, 1);
    expect(verifyAuditChain(chain).ok).toBe(false);
  });
});
