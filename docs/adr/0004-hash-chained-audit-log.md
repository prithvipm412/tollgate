# ADR 0004: Hash-chained audit log

## Status

Accepted

## Context

A firewall for money movement needs a tamper-evident record of every decision step, so that a judge, an operator, or a post-incident review can trust the log hasn't been silently edited.

## Decision

Every pipeline step appends a row to an append-only `audit_log` table. Each row stores `hash = sha256(prev_hash + canonical_json(payload))`, chaining it to the previous row. A verification endpoint walks the full chain and recomputes hashes to confirm no row was altered, reordered, or deleted.

## Consequences

- Any tampering with a historical row breaks the chain from that point forward, making it immediately detectable.
- Requires canonical JSON serialization (stable key ordering) so hash recomputation is deterministic.
- Does not prevent tampering by someone with direct DB write access and the ability to recompute the whole chain forward — it is tamper-evident, not tamper-proof against a privileged attacker. Sufficient for the hackathon's trust model (the operator is trusted; the agent and network are not).
