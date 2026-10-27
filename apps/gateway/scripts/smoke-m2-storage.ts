/** Manual Postgres execution smoke, with fake PayPal only. Run from apps/gateway:
 * pnpm exec tsx --env-file=../../.env scripts/smoke-m2-storage.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { PayPalClient, PaymentActionRequest } from "@tollgate/contracts";
import { loadConfig } from "../src/config.js";
import { createPostgresStore } from "../src/postgres-store.js";
import { GatewayService } from "../src/service.js";

const config = loadConfig();
assert.equal(
  new URL(config.DATABASE_URL).hostname,
  "localhost",
  "Use the local demo database only",
);
const sql = postgres(config.DATABASE_URL, { max: 3 });
let calls = 0;
const paypal: PayPalClient = {
  createPayout: async () => {
    calls++;
    return { payout_item_id: "M2-SMOKE-PAYOUT", status: "PENDING" };
  },
  refundCapture: async () => {
    calls++;
    return { refund_id: "M2-SMOKE-REFUND", status: "COMPLETED" };
  },
  createAndSendInvoice: async () => {
    calls++;
    return { invoice_id: "M2-SMOKE-INVOICE", status: "SENT" };
  },
  createOrder: async () => {
    calls++;
    return { order_id: "M2-SMOKE-ORDER", status: "CREATED" };
  },
  verifyWebhook: async () => false,
};
const deps = {
  paypal,
  evaluatePolicy: () => ({ verdict: "allow" as const, findings: [] }),
  scanInjection: async () => [],
  checkIntent: async () => [],
  notify: async () => {},
};
try {
  const service = new GatewayService(createPostgresStore(sql), config, deps);
  const agent = await service.createAgent("M2 Postgres execution smoke");
  const compiled = await service.compile("M2 verification");
  await service.confirmMandate({
    agent_id: agent.id,
    instruction: "M2 verification",
    policy: compiled.policy,
  });
  for (const kind of ["payout", "refund", "invoice_send", "order_create"] as const) {
    const request: PaymentActionRequest = {
      action_id: randomUUID(),
      kind,
      amount: { currency: "USD", value: "12.50" },
      reason: "Local M2 fake PayPal verification",
      ...(kind === "order_create"
        ? {}
        : {
            counterparty: {
              type: kind === "refund" ? ("capture_id" as const) : ("email" as const),
              value: kind === "refund" ? "M2-CAPTURE" : "test@example.com",
            },
          }),
    } as PaymentActionRequest;
    const results = await Promise.all([
      service.submit(agent.id, request),
      service.submit(agent.id, request),
    ]);
    assert(results.every((a) => a.request.action_id === request.action_id));
    assert.equal((await service.action(request.action_id)).status, "executed");
    // Fresh service/pool proves replay uses durable DB state, not a process cache.
    const otherSql = postgres(config.DATABASE_URL, { max: 1 });
    try {
      const restarted = new GatewayService(createPostgresStore(otherSql), config, deps);
      assert.equal((await restarted.submit(agent.id, request)).status, "executed");
    } finally {
      await otherSql.end();
    }
  }
  assert.equal(calls, 4);
  const executions =
    await sql`select * from executions e join actions a on a.id=e.action_id where a.agent_id=${agent.id}`;
  assert.equal(executions.length, 4);
  assert((await service.verifyAudit()).ok);
  const heldService = new GatewayService(createPostgresStore(sql), config, {
    ...deps,
    evaluatePolicy: () => ({ verdict: "hold" as const, findings: [] }),
  });
  const request: PaymentActionRequest = {
    action_id: randomUUID(),
    kind: "order_create",
    amount: { currency: "USD", value: "25.00" },
    reason: "M2 approval storage verification",
  };
  await heldService.submit(agent.id, request);
  const approval = (await sql`select id from approvals where action_id=${request.action_id}`)[0]!;
  const resolved = await heldService.resolveApproval(String(approval.id), "approve", "dashboard");
  assert.equal(resolved.status, "approved");
  assert.equal(calls, 5);
  assert.equal((await service.action(request.action_id)).status, "executed");
  await assert.rejects(heldService.resolveApproval(String(approval.id), "approve", "dashboard"), {
    code: "APPROVAL_ALREADY_RESOLVED",
  });
  assert((await service.verifyAudit()).ok);
  console.log(
    "M2 Postgres execution smoke passed: all four PayPal methods, concurrent duplicates, fresh-pool replay, execution rows, approval execution, and audit chain. All PayPal calls were fake.",
  );
} finally {
  await sql.end();
}
