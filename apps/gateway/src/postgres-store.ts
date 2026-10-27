import type { JSONValue, Sql } from "postgres";
import {
  ActionRecordSchema,
  AgentSchema,
  ApprovalRequestSchema,
  AuditEventSchema,
  KillSwitchStateSchema,
  MandateSchema,
  centsToMoney,
  moneyToCents,
} from "@tollgate/contracts";
import type { ActionRecord } from "@tollgate/contracts";
import type { Repository, Store, StoredAgent, StoredApproval } from "./store.js";

type Row = Record<string, unknown>;
const iso = (value: unknown) => new Date(value as string).toISOString();
function action(row: Row): ActionRecord {
  const d = row.decision as Row | null;
  const cp = row.counterparty_value
    ? {
        type: row.counterparty_type,
        value: row.counterparty_value,
        ...(row.counterparty_display_name ? { display_name: row.counterparty_display_name } : {}),
      }
    : undefined;
  return ActionRecordSchema.parse({
    request: {
      action_id: row.id,
      kind: row.kind,
      amount: centsToMoney(Number(row.amount_cents), "USD"),
      ...(cp ? { counterparty: cp } : {}),
      ...(row.category == null ? {} : { category: row.category }),
      ...(row.memo == null ? {} : { memo: row.memo }),
      reason: row.reason,
      ...(row.source_context == null ? {} : { source_context: row.source_context }),
      ...(row.metadata == null ? {} : { metadata: row.metadata }),
    },
    agent_id: row.agent_id,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    ...(row.paypal_resource_id ? { paypal_resource_id: row.paypal_resource_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(d
      ? {
          decision: {
            verdict: d.verdict,
            findings: d.findings,
            risk_score: d.risk_score,
            policy_version: d.policy_version,
            decided_at: iso(d.decided_at),
          },
        }
      : {}),
  });
}
const agent = (r: Row): StoredAgent => ({
  ...AgentSchema.parse({
    ...r,
    created_at: iso(r.created_at),
    last_seen_at: r.last_seen_at ? iso(r.last_seen_at) : null,
  }),
  key_hash: String(r.key_hash),
});
const approval = (r: Row): StoredApproval => ({
  ...ApprovalRequestSchema.parse({
    ...r,
    expires_at: iso(r.expires_at),
    decided_at: r.decided_at ? iso(r.decided_at) : undefined,
    decided_via: r.decided_via ?? undefined,
  }),
  token_hash: String(r.token_hash),
});

function repository(sql: Sql): Repository {
  return {
    async action(id) {
      const rows =
        await sql`select a.*, to_jsonb(d) as decision from actions a left join decisions d on d.action_id=a.id where a.id=${id}`;
      return rows[0] ? action(rows[0]) : undefined;
    },
    async actions(agentId) {
      return (
        await sql`select a.*, to_jsonb(d) as decision from actions a left join decisions d on d.action_id=a.id where (${agentId ?? null}::uuid is null or a.agent_id=${agentId ?? null}) order by a.id`
      ).map(action);
    },
    async saveAction(a) {
      const r = a.request;
      // Current architect-owned schema requires counterparty columns. Empty storage-only
      // value represents an absent order payer; it is never returned as a counterparty.
      await sql`insert into actions (id, agent_id, kind, amount_currency, amount_cents, counterparty_type, counterparty_value, counterparty_display_name, category, memo, reason, source_context, metadata, status, paypal_resource_id, error, created_at, updated_at)
        values (${r.action_id}, ${a.agent_id}, ${r.kind}, ${r.amount.currency}, ${moneyToCents(r.amount)}, ${r.counterparty?.type ?? "email"}, ${r.counterparty?.value ?? ""}, ${r.counterparty?.display_name ?? null}, ${r.category ?? null}, ${r.memo ?? null}, ${r.reason}, ${r.source_context ? sql.json(r.source_context) : null}, ${r.metadata ? sql.json(r.metadata) : null}, ${a.status}, ${a.paypal_resource_id ?? null}, ${a.error ?? null}, ${a.created_at}, ${a.updated_at})
        on conflict (id) do update set status=excluded.status, paypal_resource_id=excluded.paypal_resource_id, error=excluded.error, updated_at=excluded.updated_at`;
      if (a.decision) {
        const d = a.decision;
        await sql`insert into decisions (action_id, verdict, risk_score, findings, policy_version, decided_at) values (${r.action_id}, ${d.verdict}, ${d.risk_score}, ${sql.json(d.findings)}, ${d.policy_version}, ${d.decided_at}) on conflict (action_id) do nothing`;
      }
    },
    async agent(id) {
      const rows = await sql`select * from agents where id=${id}`;
      return rows[0] ? agent(rows[0]) : undefined;
    },
    async agents() {
      return (await sql`select * from agents order by id`).map(agent);
    },
    async saveAgent(a) {
      await sql`insert into agents (id,name,key_hash,key_prefix,status,created_at,last_seen_at) values (${a.id},${a.name},${a.key_hash},${a.key_prefix},${a.status},${a.created_at},${a.last_seen_at}) on conflict (id) do update set key_hash=excluded.key_hash, key_prefix=excluded.key_prefix, status=excluded.status, last_seen_at=excluded.last_seen_at`;
    },
    async mandate(agentId) {
      const rows =
        await sql`select * from mandates where agent_id=${agentId} order by version desc limit 1`;
      const r = rows[0];
      return r
        ? MandateSchema.parse({
            ...r,
            confirmed_at: iso(r.confirmed_at),
            created_at: iso(r.created_at),
          })
        : undefined;
    },
    async saveMandate(m) {
      await sql`insert into mandates (id,agent_id,instruction,policy,version,confirmed_at,created_at) values (${m.id},${m.agent_id},${m.instruction},${sql.json(m.policy)},${m.version},${m.confirmed_at},${m.created_at})`;
    },
    async approval(id) {
      const rows = await sql`select * from approvals where id=${id}`;
      return rows[0] ? approval(rows[0]) : undefined;
    },
    async approvals() {
      return (await sql`select * from approvals order by id`).map(approval);
    },
    async saveApproval(a) {
      await sql`insert into approvals (id,action_id,status,token_hash,expires_at,decided_at,decided_via) values (${a.id},${a.action_id},${a.status},${a.token_hash},${a.expires_at},${a.decided_at ?? null},${a.decided_via ?? null}) on conflict (id) do update set status=excluded.status, decided_at=excluded.decided_at, decided_via=excluded.decided_via`;
    },
    async killSwitch() {
      const rows = await sql`select value from settings where key='kill_switch'`;
      return rows[0] ? KillSwitchStateSchema.parse(rows[0].value) : { engaged: false };
    },
    async saveKillSwitch(state) {
      await sql`insert into settings (key,value) values ('kill_switch',${sql.json(state)}) on conflict (key) do update set value=excluded.value,updated_at=now()`;
    },
    async auditHead() {
      const rows = await sql`select * from audit_events order by seq desc limit 1`;
      const r = rows[0];
      return r
        ? AuditEventSchema.parse({
            ...r,
            seq: Number(r.seq),
            ts: iso(r.ts),
            action_id: r.action_id ?? undefined,
            agent_id: r.agent_id ?? undefined,
          })
        : undefined;
    },
    async audit(after = 0) {
      return (await sql`select * from audit_events where seq>${after} order by seq`).map((r) =>
        AuditEventSchema.parse({
          ...r,
          seq: Number(r.seq),
          ts: iso(r.ts),
          action_id: r.action_id ?? undefined,
          agent_id: r.agent_id ?? undefined,
        }),
      );
    },
    async appendAudit(e) {
      const rows =
        await sql`insert into audit_events (ts,type,action_id,agent_id,payload,prev_hash,hash) values (${e.ts},${e.type},${e.action_id ?? null},${e.agent_id ?? null},${sql.json(e.payload as JSONValue)},${e.prev_hash},${e.hash}) returning seq`;
      return { ...e, seq: Number(rows[0]!.seq) };
    },
    async saveExecution(a, response) {
      await sql`insert into executions (action_id,paypal_request_id,paypal_resource_id,response,status,error) values (${a.request.action_id},${a.request.action_id},${a.paypal_resource_id ?? null},${sql.json(response as JSONValue)},${a.status},${a.error ?? null})`;
    },
  };
}
export function createPostgresStore(sql: Sql): Store {
  return {
    read: (work) => work(repository(sql)),
    transaction: async (work) => {
      // Global transaction lock keeps policy history, approval consumption, kill-switch
      // changes and the audit head consistent across gateway processes.
      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(174805, 2)`;
        return { value: await work(repository(tx as unknown as Sql)) };
      });
      return result.value;
    },
  };
}
