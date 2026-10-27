import { z } from "zod";

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** One append-only, hash-chained row per pipeline step. hash = sha256(prev_hash + canonical_json(payload)). */
export const AuditEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  type: z.string().min(1),
  action_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
  prev_hash: z.string().regex(SHA256_HEX),
  hash: z.string().regex(SHA256_HEX),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditVerifyResultSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().nonnegative(),
  first_bad_seq: z.number().int().nonnegative().optional(),
});
export type AuditVerifyResult = z.infer<typeof AuditVerifyResultSchema>;
