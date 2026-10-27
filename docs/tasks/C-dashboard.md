# Codex C — Dashboard

Branch: `feat/dashboard`. Owned paths: `apps/dashboard/**`.

## Goal

Build the Next.js operator dashboard: live SSE action feed, approvals queue, mobile approval page, agent management, kill switch, mandate editor, audit verification. Build entirely against `pnpm mock:api` (fixtures-backed REST + SSE on `:4010`) — there is no real gateway to call yet.

## Read these files (and nothing else in the repo)

- `docs/ARCHITECTURE.md`
- `docs/CONTRACT.md` — REST API table is your API surface
- `packages/contracts/src/{index,action,approval,agent,audit,killswitch,mandate,policy,events,errors,stats,limits,pagination,money}.ts`
- `packages/contracts/fixtures/*` — exact demo data to design against
- `packages/contracts/mocks/server.ts` — the API you build against (port `4010`); read it to know what admin login and mutations actually do (no real auth — any password/key works)
- `apps/dashboard/package.json` — dependencies already pinned (`next@^15`, `react@^18`, `framer-motion@^11`, `tailwindcss@^3.4`); don't re-pin

## Design direction

Deep navy, dark-first: base `#0A1630`, surfaces `#12214A`, accent `#3B82F6`, allow `#22C55E`, hold `#F59E0B`, block `#EF4444`. Inter font (via `next/font`). Generous spacing, subtle glass cards (translucent surface + blur). Framer Motion for list enter/exit and status transitions — every animation must have a reduced/no-motion variant behind `prefers-reduced-motion`. Fully responsive; the approval page (`/a/[token]`) must work well on a phone screen first.

## M1 — App shell, login, Overview, Action detail

- [ ] App Router shell: dark-first theme as CSS variables for the palette above, Tailwind configured with those as theme tokens, Inter loaded via `next/font`
- [ ] `/login`: `POST /v1/auth/login`, redirect to `/overview` on success, show `ApiError.message` inline on failure
- [ ] `/overview`: live feed from `GET /v1/events` (`EventSource`; on drop, reconnect sending `Last-Event-ID`), animated verdict chips (allow/hold/block colors above) on enter/exit via Framer Motion, reduced-motion variant
- [ ] Stats tiles from `GET /v1/stats/overview`: allowed/held/blocked today, "money protected" formatted as currency from `money_protected_cents`
- [ ] `/actions/[id]`: timeline — request → findings → decision → approval (if any) → PayPal execution (show `paypal_resource_id` when present) — from `GET /v1/actions/:id`
- [ ] API base URL is an env var (e.g. `NEXT_PUBLIC_API_URL`, default `http://localhost:4010`)
- [ ] Loading and error states on every fetch on these pages (skeleton + inline error, at minimum)

**Verify:**
```
pnpm --filter @tollgate/dashboard typecheck && pnpm lint
```
Manual: in one terminal `pnpm mock:api`, in another `pnpm --filter @tollgate/dashboard dev`; visit `localhost:3000`, confirm login → overview feed animates as events arrive → click into an action's detail timeline.

## M2 — Approvals, mobile link page, agents, kill switch

- [ ] `/approvals`: queue from `GET /v1/approvals?status=pending`; Approve/Deny call `POST /v1/approvals/:id/approve|deny`
- [ ] `/a/[token]`: mobile one-time page from `GET /v1/approval-links/:token` (`ApprovalLinkView`) — big Approve/Deny buttons, amount, payee (hidden when absent — `order_create` holds have none), agent name, reasons (`findings`), live countdown to `expires_at`; resolving POSTs; a reused/expired token shows a clear terminal state, not an error page
- [ ] `/agents`: list (`GET /v1/agents`), create (`POST /v1/agents`) shows the one-time `api_key` in a copy-to-clipboard dialog warning it won't be shown again, freeze/unfreeze/rotate-key actions
- [ ] Global kill switch control (`GET`/`POST /v1/killswitch`): confirm dialog before engaging, a dramatic-but-tasteful full-viewport animated state while engaged (reduced-motion variant required)

**Verify:** same as M1, plus manually approve/deny from both `/approvals` and `/a/[token]`, and toggle the kill switch, all against `pnpm mock:api`.

## M3 — Mandate editor, audit page, PWA, Playwright

- [ ] `/agents/[id]/mandate`: plain-English textarea → "Compile" calls `POST /v1/mandates/compile`, renders the `PolicyCompileResponse` as rule cards (one per `PolicyDocument` section: limits, approval, counterparties, categories, velocity, schedule) + explanation bullets + warnings → "Confirm & enforce" calls `POST /v1/mandates`
- [ ] `/audit`: paginated log from `GET /v1/audit?cursor=`; "Verify chain" button calls `GET /v1/audit/verify` with an animated check on success, or a clear failure state highlighting `first_bad_seq` on failure
- [ ] Empty/loading/error states audited across every page from M1–M3 — list each page and its three states explicitly in your PR description
- [ ] PWA manifest scoped to `/a/[token]` (installable approval page): `manifest.json`, icons, `theme-color` matching the navy palette
- [ ] Playwright smoke test, 3 flows, run against `pnpm mock:api`: (1) login → overview shows a live action, (2) approve a held action from `/a/[token]`, (3) engage then disengage the kill switch

**Verify:**
```
pnpm --filter @tollgate/dashboard typecheck && pnpm lint && pnpm --filter @tollgate/dashboard exec playwright test
```
Note any one-time `playwright install` step in your PR.

## Out of scope

`apps/gateway`, `packages/*`. No real backend logic — build entirely against `pnpm mock:api`; don't invent mock data beyond what's already in `packages/contracts/fixtures`.

## Kickoff prompt

```
Read AGENTS.md and docs/tasks/C-dashboard.md. Do milestone M1 only. Verify with the listed commands. Commit in small Conventional Commits, push the branch, open a PR to main with `gh pr create`, then stop and summarise.
```
