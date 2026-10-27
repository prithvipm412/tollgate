import { z } from "zod";

export const KillSwitchStateSchema = z.object({
  engaged: z.boolean(),
  engaged_at: z.string().datetime().optional(),
  reason: z.string().optional(),
});
export type KillSwitchState = z.infer<typeof KillSwitchStateSchema>;
