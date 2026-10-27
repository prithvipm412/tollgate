# Codex A — Gateway + PayPal

Branch: `feat/gateway`. Owned paths: `apps/gateway/**`, `packages/paypal/**`.

## Goal

Build the typed PayPal client and the Fastify gateway: the decision pipeline, approvals, audit log, SSE events, MCP server, and webhook handling. This is the only module allowed to call PayPal or persist to Postgres.

## Read these files (and nothing else in the repo)

- `docs/ARCHITECTURE.md` — decision pipeline, trust boundaries, failure modes
- `docs/CONTRACT.md` — REST API table, MCP tools table, fixtures/mocks section
- `docs/adr/0002-deterministic-policy-ai-escalate-only.md`, `docs/adr/0003-fail-closed-on-ai-failure.md`
- `packages/contracts/src/{action,errors,events,approval,agent,audit,audit-hash,killswitch,limits,mandate,policy,money,verdict,pagination,interfaces,mcp-idempotency}.ts`
- `packages/contracts/fixtures/*` — exact demo data your seed script and tests should produce
- `packages/contracts/mocks/server.ts` — reference behavior (dashboard builds against this in parallel; match its semantics)
- `docs/openapi.yaml` — exact wire shapes
- `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`
- `.env.example`
- `apps/gateway/package.json` — dependencies already pinned (`fastify@^5.1.0`, `@modelcontextprotocol/sdk@^1.9.0`, workspace packages); don't re-pin

## M1 — PayPal client + Fastify skeleton

- [ ] `packages/paypal` exports a client implementing `PayPalClient` from `@tollgate/contracts/interfaces` exactly: `createPayout`, `refundCapture`, `createAndSendInvoice`, `createOrder`, `verifyWebhook`
- [ ] OAuth client-credentials grant with an in-memory token cache; refetches before expiry, not on every call
- [ ] Every write call sends `PayPal-Request-Id: <action_id>`
- [ ] Retry with backoff only on `5xx`/`429`; never retry on `4xx`
- [ ] `verifyWebhook` returns a boolean (never throws) — true only on a correctly verified signature
- [ ] Unit tests (nock or msw) for: happy path per method, one 5xx-then-success retry, one 429-then-success retry, a 4xx that does not retry, webhook verify true and false
- [ ] `apps/gateway`: Fastify skeleton boots; config loader is a zod schema over every var in `.env.example`, throws one typed error listing all missing/invalid vars at startup (fail fast, not on first request)
- [ ] `GET /healthz` → 200 whenever the process is up; `GET /readyz` → 200 only if the DB connection succeeds, else 503
- [ ] Agent auth: `Authorization: Bearer <api_key>` → look up agent by hashed key; `401 UNAUTHORIZED` if missing/invalid, `403 AGENT_FROZEN` if the agent is frozen
- [ ] Admin auth: `POST /v1/auth/login` sets an httpOnly cookie signed with `SESSION_SECRET`; admin routes reject without it (`401 UNAUTHORIZED`)
- [ ] Global error handler maps any thrown error to `ApiErrorSchema` JSON with the right HTTP status per `ErrorCode`
- [ ] Unit tests: config loader (missing var throws), agent auth (valid/invalid/frozen), error handler status mapping

**Verify:**
```
pnpm --filter @tollgate/paypal test && pnpm --filter @tollgate/paypal typecheck \
  && pnpm --filter @tollgate/gateway test && pnpm --filter @tollgate/gateway typecheck \
  && pnpm lint
```

## M2 — Decision pipeline, approvals, audit, SSE

- [ ] `POST /v1/actions`: validates `PaymentActionRequestSchema`; idempotent on `action_id` (a repeat with the same id returns the existing `ActionRecord`, never re-runs the pipeline)
- [ ] Pipeline calls policy/AI guard through the exact `EvaluatePolicy`/`ScanInjection`/`CheckIntent` types from `@tollgate/contracts/interfaces`, using **stub implementations you write inline** behind those types — don't block on Codex B; swap in the real `packages/policy`/`packages/guard-ai` exports in a later PR once they land
- [ ] Final verdict computed with `combineVerdicts` from `@tollgate/contracts` — don't reimplement severity ordering
- [ ] `allow` → execute via the M1 `PayPalClient`; `hold` → create an `ApprovalRequest`, a signed one-time approval link (`APPROVAL_TOKEN_SECRET`, 15 min expiry), push an ntfy notification; `block` → persist + return reasons, no PayPal call
- [ ] `GET /v1/actions/:id`, `GET /v1/actions` (admin; filters `status`, `agent_id`, `cursor`, returns `Page<ActionRecord>`), `GET /v1/me/limits` (`LimitsResponse`)
- [ ] `GET /v1/approval-links/:token` (`ApprovalLinkView`) and `POST` to resolve it — single-use, 15-min expiry, HMAC-signed, clear error on reuse/expiry
- [ ] `POST /v1/approvals/:id/approve|deny` (admin)
- [ ] Background job marks expired pending approvals `expired` and emits `approval.resolved`
- [ ] `GET/POST /v1/killswitch`: engaged → every `POST /v1/actions` and MCP tool call rejected with `KILL_SWITCH_ENGAGED` before policy evaluation, regardless of agent history
- [ ] Hash-chained audit log: every pipeline step appends a row using `computeAuditHash`/`AUDIT_GENESIS_HASH` from `@tollgate/contracts/audit-hash`; `GET /v1/audit?cursor=` (paginated), `GET /v1/audit/verify` (`verifyAuditChain`)
- [ ] An audit-log write failure aborts the pipeline **before** execution — no unlogged money movement
- [ ] `GET /v1/events`: SSE of `TollgateEvent`, each with an `id:` field, `: heartbeat` comment every 15s, `Last-Event-ID` replay
- [ ] `GET/POST /v1/agents`, `POST /v1/agents/:id/freeze|unfreeze|rotate-key`
- [ ] `POST /v1/mandates/compile`, `POST /v1/mandates`, `GET /v1/agents/:id/mandate` — wired to a stub `CompilePolicy` for now (same note as the policy/guard stubs above)
- [ ] Tests: full pipeline allow/hold/block, idempotent replay, kill-switch rejection, audit chain verifies after N actions, SSE emits the expected event sequence for one action's lifecycle

**Verify:**
```
pnpm --filter @tollgate/gateway test && pnpm --filter @tollgate/gateway typecheck && pnpm lint
```
Manual: `docker compose up -d postgres && pnpm db:migrate && pnpm --filter @tollgate/gateway dev`, then exercise the endpoints above with curl per `docs/openapi.yaml`.

## M3 — MCP server, webhook, rate limit, seed, integration tests

- [ ] MCP server at `/mcp` (Streamable HTTP, `@modelcontextprotocol/sdk`) exposing exactly the six tools in `docs/CONTRACT.md`'s MCP table, with its exact ✅/⏸/🚫 response text templates
- [ ] With `idempotency_key`: `action_id = deriveMcpActionId(agent_id, idempotency_key)` from `@tollgate/contracts/mcp-idempotency` (use as-is, don't reimplement UUIDv5). Without it: dedupe on `(agent_id, kind, amount, counterparty, memo)` within a rolling 10-minute window. Either path, a repeat call returns the existing action's current state without re-running the pipeline or calling PayPal again
- [ ] `bin/tollgate-mcp` stdio↔Streamable-HTTP bridge (the `bin` entry is already declared in `apps/gateway/package.json`)
- [ ] `POST /webhooks/paypal`: verifies signature via `PayPalClient.verifyWebhook`, dedupes by PayPal event id (`webhook_events` table), returns 200 even when skipped as a dupe
- [ ] Per-agent rate limiting on agent-key routes, config-driven
- [ ] `pnpm --filter @tollgate/gateway run seed` (add a `"seed"` script) creates the demo agent + a confirmed mandate matching the fixtures' demo story
- [ ] Integration tests against docker Postgres (root `docker-compose.yml`) exercising the full M2 pipeline plus the M3 MCP tools end to end

**Verify:**
```
docker compose up -d postgres && pnpm db:migrate && pnpm seed \
  && pnpm --filter @tollgate/gateway test && pnpm --filter @tollgate/gateway typecheck && pnpm lint
```

## Out of scope

`packages/contracts`, `packages/db`, `apps/dashboard`. Real `packages/policy`/`packages/guard-ai` implementations (stub behind the interfaces until Codex B merges — note it in your PR as a follow-up). CI/docker config changes.

## Kickoff prompt

```
Read AGENTS.md and docs/tasks/A-gateway.md. Do milestone M1 only. Verify with the listed commands. Commit in small Conventional Commits, push the branch, open a PR to main with `gh pr create`, then stop and summarise.
```
