import { z } from "zod";

export const AgentStatusSchema = z.enum(["active", "frozen"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: AgentStatusSchema,
  key_prefix: z.string().regex(/^tg_[A-Za-z0-9]{4,}$/, "e.g. 'tg_ab12'"),
  created_at: z.string().datetime(),
  last_seen_at: z.string().datetime().nullable(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** Returned once, at creation time, with the raw (unhashed) API key. Never retrievable again. */
export const AgentCreateResponseSchema = AgentSchema.extend({
  api_key: z.string().min(1),
});
export type AgentCreateResponse = z.infer<typeof AgentCreateResponseSchema>;
