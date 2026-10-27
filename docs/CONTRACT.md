# Tollgate contract (v1)

One page. Builders read this instead of the source. Full shapes: `packages/contracts/src/*.ts` (zod + inferred types). Full REST shapes: `docs/openapi.yaml` (generate with `pnpm contracts:openapi`). The contract only changes through the architect — request changes in your PR description under "Contract change request".

## Schemas (`packages/contracts`)

| Schema | One-liner |
|---|---|
| `Money` | `{ currency, value }` — decimal string, 2dp; use `moneyToCents`/`centsToMoney`, never float math. |
| `ActionKind` | `"payout" \| "refund" \| "invoice_send" \| "order_create"`. |
| `Counterparty` | Who money moves to/from: `{ type: email\|paypal_payer_id\|capture_id, value, display_name? }`. |
| `PaymentActionRequest` | What an agent submits: action_id (uuid, idempotency key), kind, amount, counterparty, category?, memo?, reason, source_context?, metadata?. Discriminated union on `kind` — `counterparty` is required for payout/refund/invoice_send and **optional** for order_create (no payer exists until checkout completes; counterparty/new-counterparty policy rules are skipped for it). |
| `Finding` | One signal from policy/AI guard: `{ source, code, severity, message, evidence? }`. |
| `Verdict` / `Decision` | `allow\|hold\|block`; Decision bundles verdict + findings + risk_score + policy_version + decided_at. |
| `ActionStatus` | Lifecycle: received → blocked \| pending_approval → approved/denied → executing → executed/failed (or expired). |
| `ActionRecord` | Persisted action: request + agent_id + decision? + status + paypal_resource_id? + error? + timestamps. |
| `PolicyDocument` (v1) | kinds_allowed, limits (per-action/daily/weekly/monthly), approval thresholds, counterparty/category allow-deny, velocity, schedule?. |
| `Mandate` | The human's confirmed, versioned policy for one agent, plus the plain-English instruction it was compiled from. |
| `Agent` / `AgentCreateResponse` | `{ id, name, status, key_prefix, created_at, last_seen_at }`; create response adds the raw `api_key` **once**. |
| `ApprovalRequest` | A hold awaiting a human: `{ id, action_id, status, expires_at, decided_at?, decided_via? }`. |
| `ApprovalLinkView` | What the mobile one-time link renders: amount, payee?, agent_name, kind, reason, findings, status, expires_at. `payee` is absent for a held order_create. |
| `AuditEvent` / `AuditVerifyResult` | Hash-chained log row (`hash = sha256(prev_hash + canonical_json(payload))`); verify result walks the chain. See `@tollgate/contracts/audit-hash` (Node-only — not in the main bundle). |
| `KillSwitchState` | `{ engaged, engaged_at?, reason? }`. |
| `TollgateEvent` | SSE union, every member carries `id` (for `Last-Event-ID` reconnect): action.received/decided/executed/failed, approval.created/resolved, agent.frozen, killswitch.changed. |
| `PolicyCompileRequest` / `PolicyCompileResponse` | NL instruction in → draft PolicyDocument + plain-English explanation bullets + warnings. |
| `ApiError` | `{ code, message, details? }`; `code` is a fixed enum (see `errors.ts`). |
| `StatsOverview` | Dashboard tiles: today's counts by verdict, money_protected_cents, pending_approvals_count, 24h hourly_series. |
| `LimitsResponse` | Per-agent usage: per_action/daily/weekly/monthly `{ limit_cents, used_cents, remaining_cents }` + velocity. |
| `Page<T>` | `{ items, next_cursor }` — every list endpoint returns this. |

### Module interfaces (types only — each package implements these)

- `evaluatePolicy({ request, policy, history, now }) → { verdict, findings }` — `packages/policy`, pure/sync, never touches an LLM.
- `compilePolicy(instruction, llm)`, `scanInjection(texts, llm)`, `checkIntent({ mandate, request }, llm)` — `packages/policy` + `packages/guard-ai`, all async, all via `LlmClient`.
- `LlmClient.completeJson({ system, user, schema, timeoutMs })` — the only way any module talks to an LLM.
- `PayPalClient` — `createPayout`, `refundCapture`, `createAndSendInvoice`, `createOrder`, `verifyWebhook`; every write is idempotent on `action_id` via `PayPal-Request-Id`.
- `combineVerdicts(findings)` — **implemented**, not just typed, in `packages/contracts`. Severity order block > hold > allow; monotonic, so appending AI findings onto policy findings can only escalate (ADR 0002).

## REST API (`docs/openapi.yaml`)

| Method & path | Auth | One-liner |
|---|---|---|
| `POST /v1/actions` | agent key | Submit a `PaymentActionRequest`; returns the resulting `ActionRecord`. |
| `GET /v1/actions/:id` | agent key **or** admin cookie | Fetch one action. |
| `GET /v1/me/limits` | agent key | Caller's `LimitsResponse`. |
| `POST /v1/auth/login` | — | `{ password }` → sets httpOnly session cookie. |
| `GET /v1/actions` | admin | List actions; filters `status`, `agent_id`, `cursor`. |
| `GET /v1/approvals?status=` | admin | List approval requests. |
| `POST /v1/approvals/:id/approve\|deny` | admin | Resolve a pending approval. |
| `GET/POST /v1/agents` | admin | List agents / create one (response includes raw key once). |
| `POST /v1/agents/:id/freeze\|unfreeze\|rotate-key` | admin | Agent lifecycle actions. |
| `POST /v1/mandates/compile` | admin | NL instruction → draft `PolicyCompileResponse`. |
| `POST /v1/mandates` | admin | Confirm a policy, creating the enforced `Mandate`. |
| `GET /v1/agents/:id/mandate` | admin | Current confirmed mandate. |
| `GET/POST /v1/killswitch` | admin | Read/engage/disengage the global kill switch. |
| `GET /v1/audit?cursor=` | admin | Paginated audit log. |
| `GET /v1/audit/verify` | admin | Walk the whole chain; `AuditVerifyResult`. |
| `GET /v1/events` | admin | SSE stream of `TollgateEvent`. Supports `Last-Event-ID` reconnect; `: heartbeat` comment every 15s. |
| `GET /v1/stats/overview` | admin | `StatsOverview` for dashboard tiles. |
| `GET/POST /v1/approval-links/:token` | one-time token | View / resolve a held action from a phone. HMAC-signed, 15-min expiry, single use. |
| `POST /webhooks/paypal` | — | PayPal webhook; signature-verified, deduped by PayPal event id. |
| `GET /healthz` / `GET /readyz` | — | Liveness / readiness. |

## MCP tools (`/mcp`, agent key in `Authorization`)

All inputs below omit `action_id` — the gateway derives or generates it server-side and returns it in the response so the agent can poll `tollgate_get_action_status`. `tollgate_create_checkout_order` has no `recipient` field at all: order_create has no counterparty (see `PaymentActionRequest` above), not a placeholder one.

Every money-moving tool takes an optional `idempotency_key` (string, 8–128 chars). Tool descriptions must tell the agent: **reuse the same `idempotency_key` when retrying a call you're unsure succeeded** — never generate a new one for what you believe is the same payment.

- **With `idempotency_key`**: `action_id = UUIDv5(MCP_IDEMPOTENCY_NAMESPACE, agent_id + ":" + idempotency_key)`, deterministic and stable across retries and gateway restarts. Implementation: `@tollgate/contracts/mcp-idempotency` (`deriveMcpActionId`, Node-only, not in the main bundle) — use it as-is, do not reimplement UUIDv5.
- **Without `idempotency_key`**: the gateway dedupes on `(agent_id, kind, amount, counterparty, memo)` within a rolling 10-minute window — an identical call in that window returns the existing action instead of creating a new one. This is a fallback, not a substitute: agents that care about retry-safety should always pass `idempotency_key`.

Either path, a second call that resolves to an existing `action_id` returns that action's current state — it does not re-run the pipeline or call PayPal again.

| Tool | Input | Maps to |
|---|---|---|
| `tollgate_send_payout` | `{ amount, recipient: Counterparty, category?, memo?, reason, source_context?, idempotency_key? }` | `kind: "payout"` |
| `tollgate_refund_capture` | `{ capture_id, amount?, reason, source_context?, idempotency_key? }` (omit amount = full refund) | `kind: "refund"` |
| `tollgate_send_invoice` | `{ amount, recipient: Counterparty, memo?, category?, reason, source_context?, idempotency_key? }` | `kind: "invoice_send"` |
| `tollgate_create_checkout_order` | `{ amount, category?, reason, source_context?, idempotency_key? }` (no `recipient`) | `kind: "order_create"` |
| `tollgate_get_action_status` | `{ action_id }` | — |
| `tollgate_get_my_limits` | `{}` | — |

Every money-moving tool call returns a short text block **in addition to** the JSON `ActionRecord`, so the agent can't miss why it was blocked:

- **allow**: `✅ Approved and executed. {kind} of {amount}{" to " + counterparty if present} succeeded (PayPal reference: {paypal_resource_id}). Action ID: {action_id}.`
- **hold**: `⏸ Held for human approval: {reasons}. A human will review it — check tollgate_get_action_status with action_id {action_id}, or wait. Do not resubmit.`
- **block**: `🚫 Blocked: {reasons}. Do NOT retry this action with a different amount, recipient, or wording — it will be blocked again and flagged for review. If this seems wrong, stop and tell your human operator.`

## Fixtures & mocks

- `packages/contracts/fixtures` — the demo story: one ordinary freelancer payout (allow), one prompt-injected invoice (block), one $350 first-time payout (hold, pending approval), one refund (allow). Plus a 13-row audit chain that actually verifies.
- `packages/contracts/mocks` — `pnpm mock:api` serves the full REST API + SSE from those fixtures on `:4010`. Accepts any agent key and any admin password. Dashboard builds against this.
