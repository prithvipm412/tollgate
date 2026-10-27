# ADR 0002: Deterministic policy engine; AI can only escalate

## Status

Accepted

## Context

Tollgate guards real money movement. An LLM is useful for catching prompt injection and mandate drift, but LLMs are non-deterministic and themselves attackable via the same untrusted text they're asked to judge.

## Decision

Spending limits, counterparty rules, categories, velocity, and thresholds are evaluated by pure, deterministic functions in `packages/policy` with no LLM involved and no I/O. The AI guard (`packages/guard-ai`) runs after the policy engine and may only move a verdict to a *more* restrictive one (`allow → hold`, `hold → block`, etc.) — it can never relax a verdict the policy engine produced.

## Consequences

- A compromised or hallucinating LLM can make Tollgate more cautious, never less — it cannot be used to approve a transaction it shouldn't.
- The policy engine alone is sufficient to reason about worst-case financial exposure, independent of AI behavior.
- Policy compilation (NL mandate → `PolicyDocument` JSON) does use an LLM, but only at setup time, requires human confirmation of the compiled JSON, and is never consulted again at payment time.
