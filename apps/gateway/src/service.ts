import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ActionRecordSchema,
  AgentSchema,
  ApprovalRequestSchema,
  FindingSchema,
  PolicyCompileResponseSchema,
  TollgateEventSchema,
  combineVerdicts,
  moneyToCents,
} from "@tollgate/contracts";
import type {
  ActionRecord,
  ApprovalRequest,
  CheckIntent,
  CompilePolicy,
  EvaluatePolicy,
  Finding,
  KillSwitchState,
  LlmClient,
  Mandate,
  PaymentActionRequest,
  PayPalClient,
  ScanInjection,
  TollgateEvent,
} from "@tollgate/contracts";
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  verifyAuditChain,
} from "@tollgate/contracts/audit-hash";
import type { Config } from "./config.js";
import { GatewayError } from "./errors.js";
import { historyFor, limitsFor } from "./history.js";
import type { Repository, Store, StoredApproval } from "./store.js";
import * as stubs from "./stubs.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const required = <T>(value: T | undefined): T => {
  if (!value) throw new GatewayError("NOT_FOUND", "Resource not found");
  return value;
};
export interface PipelineDependencies {
  paypal: PayPalClient;
  evaluatePolicy?: EvaluatePolicy;
  scanInjection?: ScanInjection;
  checkIntent?: CheckIntent;
  compilePolicy?: CompilePolicy;
  llm?: LlmClient;
  now?: () => Date;
  guardTimeoutMs?: number;
  notify?: (link: string) => Promise<void>;
}
export class GatewayService {
  private readonly now: () => Date;
  constructor(
    readonly store: Store,
    private readonly config: Config,
    private readonly deps: PipelineDependencies,
  ) {
    this.now = deps.now ?? (() => new Date());
  }
  private async audit(
    tx: Repository,
    type: string,
    data: object,
    action?: ActionRecord,
    event?: Omit<TollgateEvent, "id">,
  ) {
    const ts = this.now().toISOString();
    const payload = {
      type,
      ts,
      ...(action ? { action_id: action.request.action_id, agent_id: action.agent_id } : {}),
      data,
      ...(event ? { event } : {}),
    };
    const prev_hash = (await tx.auditHead())?.hash ?? AUDIT_GENESIS_HASH;
    await tx.appendAudit({
      type,
      ts,
      ...(action ? { action_id: action.request.action_id, agent_id: action.agent_id } : {}),
      payload,
      prev_hash,
      hash: computeAuditHash(prev_hash, payload),
    });
  }
  private async event(tx: Repository, event: Omit<TollgateEvent, "id">, action?: ActionRecord) {
    await this.audit(tx, event.type, event.payload, action, event);
  }
  async assertCanExecute(tx: Repository, agentId: string) {
    if ((await tx.killSwitch()).engaged)
      throw new GatewayError("KILL_SWITCH_ENGAGED", "Kill switch is engaged");
    if (required(await tx.agent(agentId)).status === "frozen")
      throw new GatewayError("AGENT_FROZEN", "Agent is frozen");
  }
  private async guard(work: () => Promise<Finding[]>): Promise<Finding[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const findings = await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new GatewayError("INTERNAL_ERROR", "Guard timed out")),
            this.deps.guardTimeoutMs ?? 2000,
          );
        }),
      ]);
      return FindingSchema.array().parse(findings);
    } catch {
      return [
        {
          source: "system",
          code: "AI_GUARD_UNAVAILABLE",
          severity: "hold",
          message: "AI guard failed; human review is required.",
        },
      ];
    } finally {
      clearTimeout(timer);
    }
  }
  async submit(agentId: string, request: PaymentActionRequest): Promise<ActionRecord> {
    if (
      (request.kind === "refund" && request.counterparty.type !== "capture_id") ||
      (request.kind === "invoice_send" && request.counterparty.type !== "email") ||
      (request.kind === "payout" && request.counterparty.type === "capture_id")
    )
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Counterparty type is incompatible with the action kind",
      );
    const amount = moneyToCents(request.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_147_483_647)
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Amount must be positive and fit the database integer cents range",
      );
    const prepared = await this.store.transaction(async (tx) => {
      await this.assertCanExecute(tx, agentId);
      const existing = await tx.action(request.action_id);
      if (existing) {
        if (existing.agent_id !== agentId)
          throw new GatewayError("IDEMPOTENCY_CONFLICT", "Action ID belongs to another agent");
        return { action: existing, execute: false };
      }
      const mandate = await tx.mandate(agentId);
      const ts = this.now().toISOString();
      const action: ActionRecord = {
        request,
        agent_id: agentId,
        status: "received",
        created_at: ts,
        updated_at: ts,
      };
      await tx.saveAction(action);
      await this.event(tx, { type: "action.received", payload: structuredClone(action) }, action);
      let policyResult: ReturnType<EvaluatePolicy> = mandate
        ? (this.deps.evaluatePolicy ?? stubs.evaluatePolicy)({
            request,
            policy: mandate.policy,
            history: historyFor(
              (await tx.actions(agentId)).filter((a) => a.request.action_id !== request.action_id),
              this.now(),
            ),
            now: this.now(),
          })
        : {
            verdict: "hold",
            findings: [
              {
                source: "policy",
                code: "NO_CONFIRMED_MANDATE",
                severity: "hold",
                message: "No confirmed mandate exists.",
              },
            ],
          };
      // Preserve a stricter evaluator verdict even if its findings are inconsistent.
      policyResult = {
        ...policyResult,
        findings: FindingSchema.array().parse(policyResult.findings),
      };
      const findings: Finding[] = [...policyResult.findings];
      if (policyResult.verdict !== "allow")
        findings.push({
          source: "policy",
          code: "POLICY_VERDICT",
          severity: policyResult.verdict,
          message: "Deterministic policy verdict.",
        });
      await this.audit(tx, "policy.evaluated", { findings: structuredClone(findings) }, action);
      const llm = this.deps.llm ?? stubs.llm;
      const injection = await this.guard(() =>
        (this.deps.scanInjection ?? stubs.scanInjection)(
          [request.reason, ...(request.source_context ?? [])],
          llm,
        ),
      );
      findings.push(...injection);
      await this.audit(tx, "injection.scanned", { findings: injection }, action);
      const intent = mandate
        ? await this.guard(() =>
            (this.deps.checkIntent ?? stubs.checkIntent)({ mandate, request }, llm),
          )
        : [];
      findings.push(...intent);
      await this.audit(tx, "intent.checked", { findings: intent }, action);
      const verdict = combineVerdicts(findings);
      action.decision = {
        verdict,
        findings,
        risk_score: verdict === "block" ? 100 : verdict === "hold" ? 50 : 0,
        policy_version: mandate?.version ?? 1,
        decided_at: this.now().toISOString(),
      };
      action.status =
        verdict === "block" ? "blocked" : verdict === "hold" ? "pending_approval" : "executing";
      action.updated_at = this.now().toISOString();
      await tx.saveAction(action);
      await this.event(tx, { type: "action.decided", payload: structuredClone(action) }, action);
      let link: string | undefined;
      if (verdict === "hold") {
        const approval: StoredApproval = {
          id: randomUUID(),
          action_id: request.action_id,
          status: "pending",
          expires_at: new Date(this.now().getTime() + 900_000).toISOString(),
          token_hash: "",
        };
        const token = this.signToken(approval);
        approval.token_hash = hash(token);
        await tx.saveApproval(approval);
        await this.event(
          tx,
          { type: "approval.created", payload: ApprovalRequestSchema.parse(approval) },
          action,
        );
        link = `${this.config.PUBLIC_BASE_URL}/v1/approval-links/${token}`;
      }
      if (verdict === "allow")
        await this.audit(tx, "execution.authorized", { status: "executing" }, action);
      return { action, execute: verdict === "allow", link };
    });
    if (prepared.link) await this.notify(prepared.link, prepared.action);
    return prepared.execute ? this.execute(prepared.action.request.action_id) : prepared.action;
  }
  private async notify(link: string, action: ActionRecord) {
    try {
      if (this.deps.notify) await this.deps.notify(link);
      else {
        const response = await fetch(
          `${this.config.NTFY_SERVER.replace(/\/$/, "")}/${encodeURIComponent(this.config.NTFY_TOPIC)}`,
          {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: `Payment requires human approval: ${link}`,
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        if (!response.ok) throw new GatewayError("INTERNAL_ERROR", "Notification failed");
        await response.arrayBuffer();
      }
    } catch {
      await this.store.transaction((tx) =>
        this.audit(
          tx,
          "notification.failed",
          { message: "Approval remains pending; use the dashboard." },
          action,
        ),
      );
    }
  }
  private execute(id: string): Promise<ActionRecord> {
    return this.store.transaction(async (tx) => {
      const action = required(await tx.action(id));
      if (action.status !== "executing") return action;
      // Authorization audit and claim were committed in the previous transaction.
      // Keep this lock through PayPal so a switch/freeze cannot race the last check.
      try {
        await this.assertCanExecute(tx, action.agent_id);
      } catch (error) {
        action.status = "failed";
        action.error = error instanceof GatewayError ? error.code : "INTERNAL_ERROR";
        action.updated_at = this.now().toISOString();
        await tx.saveAction(action);
        await this.event(tx, { type: "action.failed", payload: action }, action);
        return action;
      }
      let response: unknown;
      try {
        const r = action.request;
        switch (r.kind) {
          case "payout": {
            const result = await this.deps.paypal.createPayout({
              action_id: id,
              amount: r.amount,
              recipient: r.counterparty,
            });
            action.paypal_resource_id = result.payout_item_id;
            response = result;
            break;
          }
          case "refund": {
            const result = await this.deps.paypal.refundCapture({
              action_id: id,
              amount: r.amount,
              capture_id: r.counterparty.value,
            });
            action.paypal_resource_id = result.refund_id;
            response = result;
            break;
          }
          case "invoice_send": {
            const result = await this.deps.paypal.createAndSendInvoice({
              action_id: id,
              amount: r.amount,
              recipient: r.counterparty,
              memo: r.memo,
            });
            action.paypal_resource_id = result.invoice_id;
            response = result;
            break;
          }
          case "order_create": {
            const result = await this.deps.paypal.createOrder({ action_id: id, amount: r.amount });
            action.paypal_resource_id = result.order_id;
            response = result;
            break;
          }
        }
        action.status = "executed";
      } catch {
        action.status = "failed";
        action.error = "PAYPAL_ERROR";
        response = { error: "PAYPAL_ERROR" };
      }
      action.updated_at = this.now().toISOString();
      await tx.saveExecution(action, response);
      await tx.saveAction(action);
      await this.event(
        tx,
        {
          type: action.status === "executed" ? "action.executed" : "action.failed",
          payload: action,
        },
        action,
      );
      return ActionRecordSchema.parse(action);
    });
  }
  private signToken(approval: ApprovalRequest) {
    const payload = Buffer.from(
      JSON.stringify({ id: approval.id, expires_at: approval.expires_at }),
    ).toString("base64url");
    return `${payload}.${createHmac("sha256", this.config.APPROVAL_TOKEN_SECRET).update(payload).digest("base64url")}`;
  }
  private tokenId(token: string): string {
    try {
      const [payload, signature, ...rest] = token.split(".");
      if (!payload || !signature || rest.length) throw new Error("invalid token");
      const expected = createHmac("sha256", this.config.APPROVAL_TOKEN_SECRET)
        .update(payload)
        .digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
        throw new Error("invalid signature");
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as { id: string };
      if (!/^[0-9a-f-]{36}$/i.test(decoded.id)) throw new Error("invalid id");
      return decoded.id;
    } catch {
      throw new GatewayError("INVALID_TOKEN", "Invalid approval token");
    }
  }
  private async checkedApproval(tx: Repository, id: string, token?: string) {
    const approval = required(await tx.approval(id));
    if (token && hash(token) !== approval.token_hash)
      throw new GatewayError("INVALID_TOKEN", "Invalid approval token");
    if (approval.status === "expired")
      throw new GatewayError("APPROVAL_EXPIRED", "Approval has expired");
    if (approval.status !== "pending")
      throw new GatewayError("APPROVAL_ALREADY_RESOLVED", "Approval has already been resolved");
    if (Date.parse(approval.expires_at) <= this.now().getTime())
      throw new GatewayError("APPROVAL_EXPIRED", "Approval has expired");
    return approval;
  }
  async approvalLink(token: string) {
    return this.store.read(async (tx) => {
      const approval = await this.checkedApproval(tx, this.tokenId(token), token);
      const action = required(await tx.action(approval.action_id));
      const agent = required(await tx.agent(action.agent_id));
      return {
        approval_id: approval.id,
        action_id: approval.action_id,
        amount: action.request.amount,
        ...(action.request.counterparty ? { payee: action.request.counterparty } : {}),
        agent_name: agent.name,
        kind: action.request.kind,
        reason: action.request.reason,
        findings: action.decision?.findings ?? [],
        status: approval.status,
        expires_at: approval.expires_at,
      };
    });
  }
  async resolveApproval(
    idOrToken: string,
    decision: "approve" | "deny",
    via: "dashboard" | "link",
  ) {
    const id = via === "link" ? this.tokenId(idOrToken) : idOrToken;
    const result = await this.store.transaction(async (tx) => {
      const approval = await this.checkedApproval(tx, id, via === "link" ? idOrToken : undefined);
      const action = required(await tx.action(approval.action_id));
      if (decision === "approve") await this.assertCanExecute(tx, action.agent_id);
      approval.status = decision === "approve" ? "approved" : "denied";
      approval.decided_at = this.now().toISOString();
      approval.decided_via = via;
      action.status = decision === "approve" ? "executing" : "denied";
      action.updated_at = this.now().toISOString();
      await tx.saveApproval(approval);
      await tx.saveAction(action);
      await this.event(
        tx,
        { type: "approval.resolved", payload: ApprovalRequestSchema.parse(approval) },
        action,
      );
      await this.audit(
        tx,
        decision === "approve" ? "execution.authorized" : "action.denied",
        { approval_id: id },
        action,
      );
      return { approval: ApprovalRequestSchema.parse(approval), action };
    });
    if (decision === "approve") await this.execute(result.action.request.action_id);
    return result.approval;
  }
  async expireApprovals() {
    await this.store.transaction(async (tx) => {
      for (const approval of await tx.approvals()) {
        if (approval.status !== "pending" || Date.parse(approval.expires_at) > this.now().getTime())
          continue;
        approval.status = "expired";
        approval.decided_at = this.now().toISOString();
        const action = required(await tx.action(approval.action_id));
        action.status = "expired";
        action.updated_at = this.now().toISOString();
        await tx.saveApproval(approval);
        await tx.saveAction(action);
        await this.event(
          tx,
          { type: "approval.resolved", payload: ApprovalRequestSchema.parse(approval) },
          action,
        );
      }
    });
  }
  async setKillSwitch(input: { engaged: boolean; reason?: string }) {
    return this.store.transaction(async (tx) => {
      const state: KillSwitchState = {
        ...input,
        ...(input.engaged ? { engaged_at: this.now().toISOString() } : {}),
      };
      await tx.saveKillSwitch(state);
      await this.event(tx, { type: "killswitch.changed", payload: state });
      return state;
    });
  }
  async createAgent(name: string) {
    return this.store.transaction(async (tx) => {
      const api_key = `tg_${randomBytes(24).toString("hex")}`;
      const agent = {
        id: randomUUID(),
        name,
        status: "active" as const,
        key_prefix: api_key.slice(0, 11),
        created_at: this.now().toISOString(),
        last_seen_at: null,
        key_hash: hash(api_key),
      };
      await tx.saveAgent(agent);
      await this.audit(tx, "agent.created", { agent: AgentSchema.parse(agent) });
      return { ...AgentSchema.parse(agent), api_key };
    });
  }
  async updateAgent(id: string, operation: "freeze" | "unfreeze" | "rotate-key") {
    return this.store.transaction(async (tx) => {
      const agent = required(await tx.agent(id));
      let api_key: string | undefined;
      if (operation === "rotate-key") {
        api_key = `tg_${randomBytes(24).toString("hex")}`;
        agent.key_hash = hash(api_key);
        agent.key_prefix = api_key.slice(0, 11);
      } else agent.status = operation === "freeze" ? "frozen" : "active";
      await tx.saveAgent(agent);
      const publicAgent = AgentSchema.parse(agent);
      if (operation === "freeze" || operation === "unfreeze")
        await this.event(tx, { type: "agent.frozen", payload: publicAgent });
      else await this.audit(tx, "agent.key_rotated", { agent: publicAgent });
      return { ...publicAgent, ...(api_key ? { api_key } : {}) };
    });
  }
  async compile(instruction: string) {
    return PolicyCompileResponseSchema.parse(
      await (this.deps.compilePolicy ?? stubs.compilePolicy)(
        instruction,
        this.deps.llm ?? stubs.llm,
      ),
    );
  }
  async confirmMandate(input: Pick<Mandate, "agent_id" | "instruction" | "policy">) {
    return this.store.transaction(async (tx) => {
      required(await tx.agent(input.agent_id));
      const previous = await tx.mandate(input.agent_id);
      const ts = this.now().toISOString();
      const mandate: Mandate = {
        ...input,
        id: randomUUID(),
        version: (previous?.version ?? 0) + 1,
        created_at: ts,
        confirmed_at: ts,
      };
      await tx.saveMandate(mandate);
      await this.audit(tx, "mandate.confirmed", { mandate });
      return mandate;
    });
  }
  async limits(agentId: string) {
    return this.store.read(async (tx) =>
      limitsFor(
        required(await tx.mandate(agentId)).policy,
        historyFor(await tx.actions(agentId), this.now()),
      ),
    );
  }
  async action(id: string, agentId?: string) {
    return this.store.read(async (tx) => {
      const action = required(await tx.action(id));
      if (agentId && action.agent_id !== agentId)
        throw new GatewayError("FORBIDDEN", "Action belongs to another agent");
      return action;
    });
  }
  async eventsAfter(after: number): Promise<TollgateEvent[]> {
    return this.store.read(async (tx) =>
      (await tx.audit(after)).flatMap((row) =>
        row.payload.event
          ? [TollgateEventSchema.parse({ ...(row.payload.event as object), id: String(row.seq) })]
          : [],
      ),
    );
  }
  async verifyAudit() {
    return this.store.read(async (tx) => {
      const events = await tx.audit();
      const chain = verifyAuditChain(events);
      // Metadata is duplicated inside the hashed payload; bind the queryable
      // columns to that envelope so editing a row's type/time/owner is detected.
      const index = events.findIndex(
        (row) =>
          row.type !== row.payload.type ||
          row.ts !== row.payload.ts ||
          row.action_id !== row.payload.action_id ||
          row.agent_id !== row.payload.agent_id,
      );
      if (index >= 0 && (chain.ok || index < chain.checked))
        return { ok: false, checked: index, first_bad_seq: events[index]!.seq };
      return chain;
    });
  }
}
