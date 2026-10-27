import { z } from "zod";
import { ActionRecordSchema } from "./action.js";
import { ApprovalRequestSchema } from "./approval.js";
import { AgentSchema } from "./agent.js";
import { KillSwitchStateSchema } from "./killswitch.js";

/**
 * GET /v1/events (SSE). Every event carries `id` as its SSE `id:` field, so a
 * reconnecting client can send `Last-Event-ID` and the server can replay from
 * there. The server also sends a `: heartbeat` comment line every 15s so
 * proxies/load balancers don't time out the idle connection.
 */
export const TollgateEventSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("action.received"), payload: ActionRecordSchema }),
  z.object({ id: z.string(), type: z.literal("action.decided"), payload: ActionRecordSchema }),
  z.object({ id: z.string(), type: z.literal("action.executed"), payload: ActionRecordSchema }),
  z.object({ id: z.string(), type: z.literal("action.failed"), payload: ActionRecordSchema }),
  z.object({ id: z.string(), type: z.literal("approval.created"), payload: ApprovalRequestSchema }),
  z.object({ id: z.string(), type: z.literal("approval.resolved"), payload: ApprovalRequestSchema }),
  z.object({ id: z.string(), type: z.literal("agent.frozen"), payload: AgentSchema }),
  z.object({ id: z.string(), type: z.literal("killswitch.changed"), payload: KillSwitchStateSchema }),
]);
export type TollgateEvent = z.infer<typeof TollgateEventSchema>;
export type TollgateEventType = TollgateEvent["type"];
