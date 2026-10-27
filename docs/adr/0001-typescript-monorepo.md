# ADR 0001: TypeScript pnpm-workspaces monorepo

## Status

Accepted

## Context

Three parallel agents (Codex A/B/C) plus an architect (Claude) need to build independent modules — a gateway, a dashboard, a policy engine, an AI guard, a PayPal client — that share types and validation logic, within a hackathon deadline.

## Decision

Single TypeScript monorepo using pnpm workspaces. `packages/contracts` is the single source of truth for zod schemas and types, consumed by every app and package. Strict TS, ESM, Node 22+.

## Consequences

- Shared types prevent drift between gateway, dashboard, and policy/guard-ai across parallel work.
- One install, one lint/typecheck/test pipeline, one CI run — fast for judges to reproduce.
- Requires discipline on module boundaries (see ownership table in `docs/ARCHITECTURE.md`) since everyone shares one repo.
