import type { Agent, AgentCreateResponse } from "../src/index.js";
import { minutesAgo } from "./time.js";

export const AGENT_OPS_ID = "b8410ee4-6b69-4a96-9118-d1beefac8591";
export const AGENT_FROZEN_ID = "b823343c-6c78-4519-9741-1a748deaad55";

export const agentOps: Agent = {
  id: AGENT_OPS_ID,
  name: "Freelancer Payouts Bot",
  status: "active",
  key_prefix: "tg_fr8k2p",
  created_at: minutesAgo(60 * 24 * 7),
  last_seen_at: minutesAgo(2),
};

export const agentFrozen: Agent = {
  id: AGENT_FROZEN_ID,
  name: "Marketing Spend Bot",
  status: "frozen",
  key_prefix: "tg_mk3q9z",
  created_at: minutesAgo(60 * 24 * 30),
  last_seen_at: minutesAgo(60 * 24 * 3),
};

export const agents: Agent[] = [agentOps, agentFrozen];

/** AgentCreateResponse carries the raw key once, at creation — never retrievable again after this. */
export const agentCreateResponseExample: AgentCreateResponse = {
  ...agentOps,
  api_key: "tg_fr8k2p_7f1e9c2a6b3d4580af2c1e9b7d6a5c34",
};
