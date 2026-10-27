import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type {
  ActionRecord,
  AuditEvent,
  KillSwitchState,
  Mandate,
  PayPalClient,
  PaymentActionRequest,
} from "@tollgate/contracts";
import { loadConfig } from "./config.js";
import type { Repository, Store, StoredAgent, StoredApproval } from "./store.js";
import { GatewayError } from "./errors.js";
import { GatewayService } from "./service.js";
import type { PipelineDependencies } from "./service.js";
export const config = loadConfig({
  PAYPAL_CLIENT_ID: "m2-test",
  PAYPAL_CLIENT_SECRET: "m2-test",
  PAYPAL_ENV: "sandbox",
  PAYPAL_WEBHOOK_ID: "m2-test",
  DATABASE_URL: "postgres://tollgate:tollgate@localhost:5432/tollgate",
  LLM_BASE_URL: "http://localhost:11434/v1",
  LLM_API_KEY: "test",
  LLM_MODEL: "test",
  NTFY_SERVER: "https://ntfy.sh",
  NTFY_TOPIC: "m2-test",
  ADMIN_PASSWORD: "m2-test",
  SESSION_SECRET: "s".repeat(32),
  APPROVAL_TOKEN_SECRET: "a".repeat(32),
  PUBLIC_BASE_URL: "http://localhost:4000",
  DASHBOARD_URL: "http://localhost:3000",
});
interface State {
  actions: Map<string, ActionRecord>;
  agents: Map<string, StoredAgent>;
  mandates: Map<string, Mandate>;
  approvals: Map<string, StoredApproval>;
  audit: AuditEvent[];
  kill: KillSwitchState;
  executions: Map<string, unknown>;
}
export class MemoryStore implements Store {
  state: State = {
    actions: new Map(),
    agents: new Map(),
    mandates: new Map(),
    approvals: new Map(),
    audit: [],
    kill: { engaged: false },
    executions: new Map(),
  };
  failAudit?: string;
  private tail: Promise<void> = Promise.resolve();
  private repository(state: State): Repository {
    return {
      action: async (id) => structuredClone(state.actions.get(id)),
      actions: async (agentId) =>
        structuredClone(
          [...state.actions.values()].filter((a) => !agentId || a.agent_id === agentId),
        ),
      saveAction: async (a) => {
        state.actions.set(a.request.action_id, structuredClone(a));
      },
      agent: async (id) => structuredClone(state.agents.get(id)),
      agents: async () => structuredClone([...state.agents.values()]),
      saveAgent: async (a) => {
        state.agents.set(a.id, structuredClone(a));
      },
      mandate: async (id) => structuredClone(state.mandates.get(id)),
      saveMandate: async (m) => {
        state.mandates.set(m.agent_id, structuredClone(m));
      },
      approval: async (id) => structuredClone(state.approvals.get(id)),
      approvals: async () => structuredClone([...state.approvals.values()]),
      saveApproval: async (a) => {
        state.approvals.set(a.id, structuredClone(a));
      },
      killSwitch: async () => structuredClone(state.kill),
      saveKillSwitch: async (k) => {
        state.kill = structuredClone(k);
      },
      auditHead: async () => structuredClone(state.audit.at(-1)),
      audit: async (after = 0) => structuredClone(state.audit.filter((a) => a.seq > after)),
      appendAudit: async (e) => {
        if (e.type === this.failAudit)
          throw new GatewayError("INTERNAL_ERROR", "Audit unavailable");
        const row = { ...structuredClone(e), seq: state.audit.length + 1 };
        state.audit.push(row);
        return row;
      },
      saveExecution: async (a, response) => {
        if (state.executions.has(a.request.action_id))
          throw new GatewayError("IDEMPOTENCY_CONFLICT", "Duplicate execution");
        state.executions.set(a.request.action_id, structuredClone(response));
      },
    };
  }
  read<T>(work: (tx: Repository) => Promise<T>) {
    return work(this.repository(structuredClone(this.state)));
  }
  async transaction<T>(work: (tx: Repository) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const draft = structuredClone(this.state);
    try {
      const result = await work(this.repository(draft));
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }
}
export function request(overrides: Partial<PaymentActionRequest> = {}): PaymentActionRequest {
  return {
    action_id: randomUUID(),
    kind: "payout",
    amount: { currency: "USD", value: "25.00" },
    counterparty: { type: "email", value: "contractor@example.com" },
    reason: "Pay contracted work",
    ...overrides,
  } as PaymentActionRequest;
}
export async function setup(overrides: Partial<PipelineDependencies> = {}) {
  const store = new MemoryStore();
  const paypal: PayPalClient = {
    createPayout: vi.fn(async () => ({ payout_item_id: "payout", status: "PENDING" })),
    refundCapture: vi.fn(async () => ({ refund_id: "refund", status: "COMPLETED" })),
    createAndSendInvoice: vi.fn(async () => ({ invoice_id: "invoice", status: "SENT" })),
    createOrder: vi.fn(async () => ({ order_id: "order", status: "CREATED" })),
    verifyWebhook: vi.fn(async () => false),
  };
  const evaluatePolicy = vi.fn<NonNullable<PipelineDependencies["evaluatePolicy"]>>(() => ({
    verdict: "allow",
    findings: [],
  }));
  const scanInjection = vi.fn<NonNullable<PipelineDependencies["scanInjection"]>>(async () => []);
  const checkIntent = vi.fn<NonNullable<PipelineDependencies["checkIntent"]>>(async () => []);
  const notify = vi.fn(async (_link: string) => {});
  const deps = { paypal, evaluatePolicy, scanInjection, checkIntent, notify, ...overrides };
  const service = new GatewayService(store, config, deps);
  const agent = await service.createAgent("M2 test agent");
  const mandate = await service.confirmMandate({
    agent_id: agent.id,
    instruction: "Pay contractors",
    policy: {
      version: 1,
      kinds_allowed: ["payout", "refund", "invoice_send", "order_create"],
      limits: { daily_max: { currency: "USD", value: "1000.00" } },
      approval: { new_counterparty: false },
      counterparties: {},
      categories: {},
      velocity: {},
    },
  });
  return {
    store,
    paypal,
    evaluatePolicy,
    scanInjection,
    checkIntent,
    notify,
    service,
    agent,
    mandate,
  };
}
