# Dashboard

Run `pnpm mock:api` and `pnpm --filter @tollgate/dashboard dev`, then open http://localhost:3000. Any password works with the fixture API.

`NEXT_PUBLIC_API_URL` selects the upstream API (default `http://localhost:4010`). Restart Next.js after changing it. Browser requests use the same-origin `/v1` rewrite so the httpOnly session cookie and native EventSource reconnect headers work without credentialed cross-origin CORS.

The feed seeds from `/v1/actions`, reconciles live action events by action id and update timestamp, and keeps the latest 100 requests. Native EventSource reconnects with `Last-Event-ID`; the mock accepts the header but does not replay missed events. Stats refresh on connection and action/approval events. The fixture stats endpoint returns fixed fixture totals.

Action detail shows the current record, including findings and PayPal reference. Approval resolution identity/timestamp are not available in ActionRecord; the timeline labels that limitation rather than inventing history.

M2 adds `/approvals`, `/agents`, and the public `/a/[token]` page. The phone page hides absent payees, counts down to expiry, and stops accepting decisions after expiry or resolution. Fixture approval links are single-use; restart the mock to test another decision using `demo_9f8e7d6c5b4a3f2e1d0c`.

Agent creation and key rotation show the raw API key in a modal once. Closing the modal clears the key from page state. Agent rows retain only the public prefix.

The global payment control is available on operator pages. Engagement requires confirmation, then a full-screen modal offers resume. It refreshes from SSE, reconnect, and a 15-second poll; it does not claim success before the API responds. The pulse is static under reduced motion. Public approval links and login do not fetch admin kill-switch state.

Verify with `pnpm --filter @tollgate/dashboard typecheck && pnpm lint && pnpm --filter @tollgate/dashboard test`. M2 browser checks cover queue approve/deny, mobile approve/deny and reused/expired links, agent create/copy/freeze/unfreeze/rotate, and kill-switch cancel/engage/resume.
