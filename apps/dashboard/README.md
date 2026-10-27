# Dashboard M1

Run `pnpm mock:api` and `pnpm --filter @tollgate/dashboard dev`, then open http://localhost:3000. Any password works with the fixture API.

`NEXT_PUBLIC_API_URL` selects the upstream API (default `http://localhost:4010`). Restart Next.js after changing it. Browser requests use the same-origin `/v1` rewrite so the httpOnly session cookie and native EventSource reconnect headers work without credentialed cross-origin CORS.

The feed seeds from `/v1/actions`, reconciles live action events by action id and update timestamp, and keeps the latest 100 requests. Native EventSource reconnects with `Last-Event-ID`; the mock accepts the header but does not replay missed events. Stats refresh on connection and action/approval events. The fixture stats endpoint returns fixed fixture totals.

Action detail shows the current record, including findings and PayPal reference. Approval resolution identity/timestamp are not available in ActionRecord; the timeline labels that limitation rather than inventing history.

React 18 type declarations are required for Next.js TSX. Installed with `--lockfile=false` to honor dashboard-only ownership; the architect must regenerate the root pnpm lockfile before a frozen install.
