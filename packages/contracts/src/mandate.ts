import { z } from "zod";
import { PolicyDocumentSchema } from "./policy.js";

export const MandateSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  instruction: z.string().min(1).max(4000),
  policy: PolicyDocumentSchema,
  version: z.number().int().positive(),
  confirmed_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type Mandate = z.infer<typeof MandateSchema>;
