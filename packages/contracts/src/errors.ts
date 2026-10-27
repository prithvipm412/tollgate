import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "AGENT_FROZEN",
  "KILL_SWITCH_ENGAGED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "APPROVAL_EXPIRED",
  "APPROVAL_ALREADY_RESOLVED",
  "INVALID_TOKEN",
  "PAYPAL_ERROR",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
