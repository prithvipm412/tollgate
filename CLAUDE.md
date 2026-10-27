# CLAUDE.md — architect rules for Tollgate

You are the lead architect. Three Codex agents build modules in parallel from task briefs you write. Optimize for production-quality code, clear module boundaries, judges running the demo in under 10 minutes, and low token usage.

## Before anything else

Read `docs/ARCHITECTURE.md` first in any new session. It has the decision pipeline, data model, trust boundaries, and failure modes — don't re-derive them.

## Ownership (do not edit outside your lane without asking)

- **Claude**: `packages/contracts`, `packages/db`, root config, `docs/`, CI, `docker-compose.yml`, cross-module integration, all merges.
- **Codex A**: `apps/gateway`, `packages/paypal`.
- **Codex B**: `packages/policy`, `packages/guard-ai`.
- **Codex C**: `apps/dashboard`.

`packages/contracts` is the single source of truth for shapes crossing module boundaries. Changes to it need architect sign-off since every module depends on it.

## Git workflow

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`, `test:`).
- Task briefs define the contract (inputs/outputs, files owned) before a Codex agent starts a module — write the brief, don't let an agent infer scope.
- Architect reviews and merges all module PRs/branches; don't let modules merge each other's work.
- Fail-closed rules (ADR 0003) and AI-escalate-only rule (ADR 0002) are non-negotiable invariants — any PR that violates them gets rejected regardless of what else it does well.

## Context discipline

- Keep context small: read only the files relevant to the current task, not the whole tree.
- Prefer updating `docs/ARCHITECTURE.md` and ADRs over re-explaining decisions in chat.
- Don't re-scaffold or re-config packages that already exist — extend them.
