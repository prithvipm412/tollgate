import type {
  ActionRecord,
  Agent,
  ApprovalRequest,
  AuditEvent,
  KillSwitchState,
  Mandate,
} from "@tollgate/contracts";

export type StoredAgent = Agent & { key_hash: string };
export type StoredApproval = ApprovalRequest & { token_hash: string };
export interface Repository {
  action(id: string): Promise<ActionRecord | undefined>;
  actions(agentId?: string): Promise<ActionRecord[]>;
  saveAction(action: ActionRecord): Promise<void>;
  agent(id: string): Promise<StoredAgent | undefined>;
  agents(): Promise<StoredAgent[]>;
  saveAgent(agent: StoredAgent): Promise<void>;
  mandate(agentId: string): Promise<Mandate | undefined>;
  saveMandate(mandate: Mandate): Promise<void>;
  approval(id: string): Promise<StoredApproval | undefined>;
  approvals(): Promise<StoredApproval[]>;
  saveApproval(approval: StoredApproval): Promise<void>;
  killSwitch(): Promise<KillSwitchState>;
  saveKillSwitch(state: KillSwitchState): Promise<void>;
  auditHead(): Promise<AuditEvent | undefined>;
  audit(after?: number): Promise<AuditEvent[]>;
  appendAudit(event: Omit<AuditEvent, "seq">): Promise<AuditEvent>;
  saveExecution(action: ActionRecord, response: unknown): Promise<void>;
}
export interface Store {
  /** Serializes mutations across processes, commits on success, rolls back on error. */
  transaction<T>(work: (repository: Repository) => Promise<T>): Promise<T>;
  read<T>(work: (repository: Repository) => Promise<T>): Promise<T>;
}
