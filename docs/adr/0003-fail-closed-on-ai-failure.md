# ADR 0003: Fail closed to `hold` on AI guard failure

## Status

Accepted

## Context

The AI guard calls an external (or local) LLM provider, which can time out, error, or return malformed output. The pipeline must decide what verdict to produce when it cannot get a usable answer from the AI guard.

## Decision

Any AI guard failure — provider error, timeout, or an LLM judge response that isn't valid strict JSON — is treated as escalating the verdict to `hold` (human approval required). The system never fails open to `allow` when the AI guard cannot complete its check.

## Consequences

- Worst case on an AI outage is a slower, human-gated agent — not an unguarded payment.
- Demo and judges can simulate this by pointing `LLM_BASE_URL` at nothing and observing that everything routes to approval instead of erroring or allowing.
- Adds latency/friction during AI provider outages; acceptable tradeoff for a money-movement firewall.
