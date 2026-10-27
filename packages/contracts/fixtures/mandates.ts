import type { Mandate, PolicyDocument } from "../src/index.js";
import { AGENT_OPS_ID } from "./agents.js";
import { minutesAgo } from "./time.js";

export const MANDATE_ID = "5f334f5d-ebb6-4dbb-8436-117a2347147b";

export const policyDocument: PolicyDocument = {
  version: 1,
  kinds_allowed: ["payout", "refund", "invoice_send"],
  limits: {
    per_action_max: { currency: "USD", value: "300.00" },
    daily_max: { currency: "USD", value: "1000.00" },
    weekly_max: { currency: "USD", value: "4000.00" },
    monthly_max: { currency: "USD", value: "12000.00" },
  },
  approval: {
    require_above: { currency: "USD", value: "300.00" },
    always_for_kinds: [],
    new_counterparty: true,
  },
  counterparties: {
    deny: ["*@tempmail.*", "*@mailinator.*"],
  },
  categories: {
    allow: ["freelance", "contractor_payout", "refund"],
  },
  velocity: {
    max_actions_per_hour: 10,
  },
  schedule: {
    days: ["mon", "tue", "wed", "thu", "fri"],
    start_hour: 8,
    end_hour: 20,
    tz: "America/New_York",
  },
};

export const mandate: Mandate = {
  id: MANDATE_ID,
  agent_id: AGENT_OPS_ID,
  instruction:
    "Pay our freelance contractors their invoiced amounts automatically, up to $300 per payment. Hold anything above $300, or to anyone we haven't paid before, for my approval. Never pay gift cards or send money outside business hours.",
  policy: policyDocument,
  version: 1,
  confirmed_at: minutesAgo(60 * 24 * 7),
  created_at: minutesAgo(60 * 24 * 7),
};
