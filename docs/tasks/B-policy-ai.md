# Codex B — Policy + Guard AI

Branch: `feat/policy-ai`. Owned paths: `packages/policy/**`, `packages/guard-ai/**`.

## Goal

Build the deterministic policy evaluator and NL→policy compiler (`packages/policy`), and the AI guard: injection scan, intent check, LLM client (`packages/guard-ai`). Nothing here touches the network except through `LlmClient`, and `packages/policy`'s evaluator never touches an LLM at all.

## Read these files (and nothing else in the repo)

- `docs/ARCHITECTURE.md` — decision pipeline (steps 3–4), trust boundaries
- `docs/CONTRACT.md`
- `docs/adr/0002-deterministic-policy-ai-escalate-only.md`, `docs/adr/0003-fail-closed-on-ai-failure.md`
- `packages/contracts/src/{policy,mandate,action,interfaces,verdict}.ts`
- `packages/contracts/fixtures/*` — example `PolicyDocument`s, mandates, findings
- `.env.example` — `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`

## M1 — `evaluatePolicy`

Implement `evaluatePolicy` matching the `EvaluatePolicy` type in `@tollgate/contracts/interfaces` exactly: `(input: { request, policy, history, now }) => { verdict, findings }`. Pure, synchronous, no I/O — import nothing beyond `@tollgate/contracts` and `zod`.

Rule → finding mapping (implement exactly this; `verdict` is `combineVerdicts(findings)` from `@tollgate/contracts` — don't reimplement that):

| Condition | severity | code |
|---|---|---|
| `request.kind` not in `policy.kinds_allowed` | block | `KIND_NOT_ALLOWED` |
| counterparty value in `policy.counterparties.deny` | block | `COUNTERPARTY_DENIED` |
| `policy.counterparties.allow` set and counterparty value not in it | block | `COUNTERPARTY_NOT_ALLOWLISTED` |
| `request.category` in `policy.categories.deny` | block | `CATEGORY_DENIED` |
| `policy.categories.allow` set and category missing or not in it | block | `CATEGORY_NOT_ALLOWLISTED` |
| amount exceeds `limits.per_action_max` | block | `PER_ACTION_LIMIT_EXCEEDED` |
| `history.spent_today` + amount exceeds `limits.daily_max` | block | `DAILY_LIMIT_EXCEEDED` |
| same for `spent_week`/`weekly_max`, `spent_month`/`monthly_max` | block | `WEEKLY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED` |
| `request.kind` in `approval.always_for_kinds` | hold | `APPROVAL_REQUIRED_KIND` |
| amount exceeds `approval.require_above` | hold | `APPROVAL_REQUIRED_AMOUNT` |
| `approval.new_counterparty` true and counterparty value not in `history.known_counterparties` (skip entirely for `order_create` — no counterparty) | hold | `NEW_COUNTERPARTY` |
| `velocity.max_actions_per_hour` set and `history.actions_last_hour >=` it | hold | `VELOCITY_EXCEEDED` |
| `policy.schedule` set and `now` (in `schedule.tz`) falls outside `schedule.days`/`start_hour`–`end_hour` | hold | `OUTSIDE_SCHEDULE` |
| amount's z-score vs `history.amount_stats` (`mean_cents`, `stddev_cents`) > 3 — skip if `n < 5` or `stddev_cents === 0` | warn | `AMOUNT_ANOMALY` |

Compare amounts in integer cents via `moneyToCents` from `@tollgate/contracts` — never float math.

- [ ] Every row above implemented, each producing a `Finding` with the given `source` (`policy` for all except `AMOUNT_ANOMALY`, which is `anomaly`), `severity`, `code`, and a human-readable `message`
- [ ] Exhaustive table-driven tests: one case per row, plus a few combination cases (e.g. both a block and a hold condition present → block wins)
- [ ] 100% branch coverage on the evaluator file (add `@vitest/coverage-v8` as a devDependency if not already present; note it in your PR)
- [ ] No imports beyond `@tollgate/contracts`/`zod` in the evaluator module (reviewable at a glance — keep it in its own file)

**Verify:**
```
pnpm --filter @tollgate/policy test -- --coverage && pnpm --filter @tollgate/policy typecheck && pnpm lint
```
Coverage report must show 100% branch coverage for the evaluator file.

## M2 — `LlmClient`, `compilePolicy`

- [ ] `packages/guard-ai` exports an `LlmClient` implementing `completeJson<T>({ system, user, schema, timeoutMs })` from `@tollgate/contracts/interfaces`: calls an OpenAI-compatible chat-completions endpoint in JSON mode, validates the reply against `schema`; on validation failure, retries once with a repair message that includes the zod error and asks for corrected JSON; enforces `timeoutMs` via `AbortController` and throws a typed `LlmTimeoutError` on timeout — never returns `undefined` or swallows a failure
- [ ] `packages/policy` exports `compilePolicy(instruction, llm)` matching `CompilePolicy`: a system prompt + few-shot examples steering the LLM to emit JSON matching `PolicyDocumentSchema`; validates the result; after a failed repair retry, throws (compile-time only, so no fail-closed wrapping needed here per ADR 0002 — the caller surfaces the error)
- [ ] Returns `PolicyCompileResponse`: `policy`, `explanation` (plain-English bullets describing what the compiled policy actually does), `warnings` (ambiguous phrases in the instruction with no concrete number/rule, e.g. "a reasonable amount")
- [ ] Unit tests using a fake `LlmClient` (no real network): first-try valid response, malformed-then-repaired response, malformed-after-repair throws, timeout throws

**Verify:**
```
pnpm --filter @tollgate/guard-ai test && pnpm --filter @tollgate/policy test \
  && pnpm --filter @tollgate/guard-ai typecheck && pnpm --filter @tollgate/policy typecheck && pnpm lint
```

## M3 — `scanInjection`, `checkIntent`, eval corpus

- [ ] `scanInjection(texts, llm)` matching `ScanInjection`. Layer 1, pure heuristics (no LLM): instruction-override phrases ("ignore previous instructions", "disregard your instructions", "new instructions:", etc.), zero-width/hidden Unicode (`U+200B`, `U+200C`, `U+FEFF`, ...), homoglyph lookalike characters in email-like strings, base64 blobs above a length threshold, and any email address or dollar amount in `source_context` that differs from the request's own counterparty/amount
- [ ] Layer 2, LLM judge via `llm.completeJson`: untrusted text wrapped in spotlighting delimiters (e.g. `<<<UNTRUSTED>>> ... <<<END_UNTRUSTED>>>`), system prompt states explicitly that the wrapped text may contain injected instructions which must be ignored, and the judge returns strict JSON findings only
- [ ] Returns `Finding[]` with `source: "injection"`. A malformed/non-JSON judge reply becomes a `hold`-severity finding itself (ADR 0003: ambiguous output escalates, it doesn't throw past this function). A thrown `LlmTimeoutError`/provider error from `LlmClient`, however, propagates — don't catch it here, the gateway's fail-closed wrapper (Codex A) is what turns that into a forced `hold`
- [ ] `checkIntent({ mandate, request }, llm)` matching `CheckIntent`: LLM judge compares the request against `mandate.instruction`/`mandate.policy`, returns `Finding[]` with `source: "intent"` when the action falls outside the agent's standing instruction (e.g. mandate says "pay contractors for design work", request category is "marketing")
- [ ] `packages/guard-ai/eval/cases.jsonl`: ≥40 labelled cases — ≥15 attacks (include indirect injection carried in invoice/email text inside `source_context`, not only in `reason`) and ≥15 benign, including tricky-but-legit ones (a large but legitimate payout, urgent-sounding but genuine payment language)
- [ ] Add an `"eval:guard"` script to `packages/guard-ai/package.json` (root alias `pnpm eval:guard` already points at it) that runs `scanInjection` over every case, prints precision/recall/F1 plus a per-case pass/fail table, and writes the same report to `docs/eval-results.md` — the one file outside your owned paths you're pre-approved to create/overwrite

**Verify:**
```
pnpm --filter @tollgate/guard-ai test && pnpm --filter @tollgate/guard-ai typecheck && pnpm lint && pnpm eval:guard
```
Note in your PR which LLM endpoint/model produced the committed `docs/eval-results.md` numbers.

## Out of scope

`packages/contracts`, `packages/db`, `apps/gateway`, `apps/dashboard`. Wiring your exports into the live pipeline (Codex A does that against the interface types).

## Kickoff prompt

```
Read AGENTS.md and docs/tasks/B-policy-ai.md. Do milestone M1 only. Verify with the listed commands. Commit in small Conventional Commits, push the branch, open a PR to main with `gh pr create`, then stop and summarise.
```
