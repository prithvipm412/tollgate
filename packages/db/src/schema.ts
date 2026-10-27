import { bigserial, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const agentStatusEnum = pgEnum("agent_status", ["active", "frozen"]);
export const actionKindEnum = pgEnum("action_kind", ["payout", "refund", "invoice_send", "order_create"]);
export const actionStatusEnum = pgEnum("action_status", [
  "received",
  "blocked",
  "pending_approval",
  "approved",
  "denied",
  "expired",
  "executing",
  "executed",
  "failed",
]);
export const verdictEnum = pgEnum("verdict", ["allow", "hold", "block"]);
export const counterpartyTypeEnum = pgEnum("counterparty_type", ["email", "paypal_payer_id", "capture_id"]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "denied", "expired"]);
export const approvalDecidedViaEnum = pgEnum("approval_decided_via", ["dashboard", "link"]);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  status: agentStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    instruction: text("instruction").notNull(),
    policy: jsonb("policy").notNull(),
    version: integer("version").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("mandates_agent_version_idx").on(table.agentId, table.version)],
);

export const actions = pgTable(
  "actions",
  {
    // The action's own id doubles as the idempotency key the agent generated client-side.
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    kind: actionKindEnum("kind").notNull(),
    amountCurrency: text("amount_currency").notNull(),
    amountCents: integer("amount_cents").notNull(),
    counterpartyType: counterpartyTypeEnum("counterparty_type").notNull(),
    counterpartyValue: text("counterparty_value").notNull(),
    counterpartyDisplayName: text("counterparty_display_name"),
    category: text("category"),
    memo: text("memo"),
    reason: text("reason").notNull(),
    sourceContext: jsonb("source_context"),
    metadata: jsonb("metadata"),
    status: actionStatusEnum("status").notNull().default("received"),
    paypalResourceId: text("paypal_resource_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("actions_agent_id_idx").on(table.agentId),
    index("actions_status_idx").on(table.status),
    index("actions_created_at_idx").on(table.createdAt.desc()),
  ],
);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionId: uuid("action_id")
    .notNull()
    .unique()
    .references(() => actions.id),
  verdict: verdictEnum("verdict").notNull(),
  riskScore: integer("risk_score").notNull(),
  findings: jsonb("findings").notNull(),
  policyVersion: integer("policy_version").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: uuid("action_id")
      .notNull()
      .unique()
      .references(() => actions.id),
    status: approvalStatusEnum("status").notNull().default("pending"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedVia: approvalDecidedViaEnum("decided_via"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approvals_status_expires_idx").on(table.status, table.expiresAt)],
);

export const executions = pgTable("executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionId: uuid("action_id")
    .notNull()
    .unique()
    .references(() => actions.id),
  paypalRequestId: text("paypal_request_id").notNull(),
  paypalResourceId: text("paypal_resource_id"),
  response: jsonb("response"),
  status: text("status").notNull(),
  error: text("error"),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    actionId: uuid("action_id"),
    agentId: uuid("agent_id"),
    payload: jsonb("payload").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull().unique(),
  },
  (table) => [index("audit_events_action_id_idx").on(table.actionId), index("audit_events_agent_id_idx").on(table.agentId)],
);

/** Singleton settings rows, e.g. key='kill_switch'. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Dedupes incoming PayPal webhook deliveries by their event id. */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const KILL_SWITCH_SETTINGS_KEY = "kill_switch";
