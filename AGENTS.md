# AGENTS.md

Tollgate is a firewall for AI agents that move money through PayPal: every payment request passes through a deterministic policy engine, then an AI guard that can only make a verdict *stricter*, never looser, before anything touches PayPal's sandbox.

Read `docs/ARCHITECTURE.md` and your brief in `docs/tasks/` before writing code. Full contract: `docs/CONTRACT.md` + the specific files it points you to in `packages/contracts/src/`.

## Monorepo map

- `apps/gateway` — Fastify REST API + MCP server (Streamable HTTP `/mcp`) + stdio bridge bin `tollgate-mcp`
- `apps/dashboard` — Next.js operator UI
- `packages/contracts` — zod schemas/types, OpenAPI gen, fixtures, mock API server (**architect-owned, do not edit**)
- `packages/db` — Postgres schema + Drizzle migrations (**architect-owned, do not edit**)
- `packages/paypal` — typed PayPal REST client
- `packages/policy` — deterministic policy evaluator + NL→policy compiler
- `packages/guard-ai` — injection scan, intent check, LLM client, eval corpus

## Commands

- Install: `pnpm install`, then once per checkout: `pnpm build` (builds `packages/contracts` + `packages/db` so everything else can import their compiled output)
- Dev: `pnpm dev`
- Test: `pnpm test`, or scoped: `pnpm --filter <pkg-name> test`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`, or scoped: `pnpm --filter <pkg-name> typecheck`
- Mock API (fixtures-backed REST + SSE on `:4010`, no real backend needed): `pnpm mock:api`
- DB migrate (needs `docker compose up -d postgres` first): `pnpm db:migrate`

## Hard rules

1. Only edit files inside your owned paths (see your brief's "Owned paths"). **Never** edit `packages/contracts` or `packages/db` — if you need a contract change, build against the current shape and describe the change you want under "Contract change request" in your PR description. The architect reviews and makes contract changes.
2. Never commit secrets, `.env`, or real credentials. `.env.example` is the template; copy it to `.env` locally and never stage `.env`.
3. Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Keep commits small and scoped to one change.
4. Run `pnpm lint && pnpm typecheck && pnpm test` (scoped to your package/app is fine) before every push.
5. Open a PR to `main` with `gh pr create` when a milestone is done — don't merge your own or anyone else's PR. Keep each PR under ~600 changed lines where possible; one PR per milestone.
6. Don't add a dependency without saying why in the PR description.
7. Fail-closed and AI-escalate-only are non-negotiable invariants (ADR 0002, ADR 0003): AI guard failure/timeout → verdict escalates to `hold`, never `allow`; AI findings can only raise a verdict, never lower one. Use `combineVerdicts` from `@tollgate/contracts` — don't reimplement that logic.

## Token discipline

- Read only your brief and the contract files it lists. Don't scan the whole repo or read other builders' briefs.
- One milestone per session: do the milestone, verify with the listed commands, commit, open the PR, then stop. Don't start the next milestone in the same session.

## Definition of done (per milestone)

- Tests cover new logic (unit tests for pure functions; integration tests where the brief asks for them).
- No `TODO`s left in critical paths (anything on the money-moving or decision path).
- Errors are typed (`ApiError` / a typed exception class), never thrown as bare strings.
- PR description states: what was built, the exact commands used to verify it, and any contract change requests.
