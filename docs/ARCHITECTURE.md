# Architecture

## Components

| Component | Path | Responsibility |
|---|---|---|
| Gateway | `apps/gateway` | Fastify REST API, SSE event stream, MCP server (Streamable HTTP at `/mcp`), stdio bridge bin `tollgate-mcp` |
| Dashboard | `apps/dashboard` | Next.js operator UI: policy review/confirm, live event feed, mobile approval page, kill switch |
| Contracts | `packages/contracts` | zod schemas + TS types + OpenAPI generation — single source of truth for all request/response/entity shapes |
| DB | `packages/db` | Postgres schema + Drizzle ORM + migrations |
| PayPal | `packages/paypal` | Typed REST client: OAuth client-credentials (token cache), retries with backoff on 5xx/429 only, webhook signature verification |
| Policy | `packages/policy` | Pure, I/O-free evaluation of a `PolicyDocument` (limits, allow/deny, velocity, thresholds) + NL→policy compiler |
| Guard AI | `packages/guard-ai` | Injection scan, intent check, OpenAI-compatible LLM client, eval corpus + precision/recall script |

## Decision pipeline

Every money-moving request passes through, in order:

1. **Authenticate** the agent (hashed API key). Reject if the agent is frozen or the global kill switch is engaged.
2. **Validate** the request against `packages/contracts` zod schemas. Check idempotency on `action_id`.
3. **Policy engine** (deterministic, pure functions): spending limits, counterparty allow/deny, categories, velocity, approval thresholds, new-counterparty rule, simple anomaly stats. Produces `allow | hold | block` + findings.
4. **AI guard** (can only escalate a verdict, never relax it):
   - Injection scan of `reason` and `source_context` — heuristics plus an LLM judge. Untrusted text is spotlighted/wrapped; the judge must return strict JSON.
   - Intent check: does the action fit the agent's mandate (the human's standing instruction)?
   - If the AI provider fails or times out → **fail closed to `hold`** (human approval). Never fail open to `allow`.
5. **Final verdict** = most severe of all findings from steps 3–4. Persisted immediately.
6. **Execution**:
   - `allow` → execute against PayPal sandbox with `PayPal-Request-Id = action_id` (idempotent).
   - `hold` → create an `ApprovalRequest`, push an ntfy notification with a signed one-time approval link; agent receives `pending_approval` and polls for status.
   - `block` → return reasons to the agent; no PayPal call.
7. **Audit**: every step appends a row to a hash-chained log — `hash = sha256(prev_hash + canonical_json(payload))`. A verification endpoint walks the chain and confirms no row was altered or removed.
8. **Live events** stream to the dashboard over SSE as the pipeline progresses.

## Data model overview

- `agents` — id, name, hashed API key, mandate text, frozen flag.
- `policy_documents` — versioned, zod-validated JSON compiled from the human's NL mandate; only a human-confirmed version is enforced.
- `actions` — one row per guarded request (`action_id` is the idempotency key), type (`payout | refund | invoice_send | order_create`), status, verdict, findings.
- `approval_requests` — linked to an action on `hold`, signed one-time token, resolution (approved/denied/expired).
- `audit_log` — append-only, hash-chained, one row per pipeline step per action.
- `paypal_operations` — record of the PayPal API call made for an executed action (request id, response, status).

## Trust boundaries

**Everything the agent sends is untrusted**, including `reason` and any `source_context` (e.g. invoice text an agent read from an inbox). This text is never passed to the AI guard's LLM judge as part of the instruction — it is spotlighted/wrapped and the judge is told explicitly it may contain injected instructions and must ignore any directives found inside it, returning only a strict JSON verdict.

The policy engine never calls an LLM and is not reachable by agent-supplied text beyond typed, validated fields — it cannot be prompt-injected.

## Failure modes (fail-closed rules)

- AI guard provider error/timeout → verdict escalates to `hold`, never `allow`.
- Ambiguous or malformed LLM judge output (not strict JSON) → treated as an injection/intent finding, escalates to `hold` or `block`.
- Kill switch engaged → all actions rejected before policy evaluation, regardless of history.
- Audit log write failure → the action is not executed; the pipeline aborts (no silent unlogged money movement).
- PayPal API failure on an `allow` → surfaced to the agent as an error; the action is not retried automatically except via PayPal's own idempotency on `PayPal-Request-Id`.

## Module ownership

| Owner | Scope |
|---|---|
| Claude (architect) | `packages/contracts`, `packages/db`, root config, `docs/`, CI, `docker-compose.yml`, integration, merges |
| Codex A | `apps/gateway`, `packages/paypal` |
| Codex B | `packages/policy`, `packages/guard-ai` |
| Codex C | `apps/dashboard` |
