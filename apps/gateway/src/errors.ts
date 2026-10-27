import type { ErrorCode } from "@tollgate/contracts";
export const errorStatus: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  AGENT_FROZEN: 403,
  KILL_SWITCH_ENGAGED: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  APPROVAL_EXPIRED: 410,
  APPROVAL_ALREADY_RESOLVED: 409,
  INVALID_TOKEN: 410,
  PAYPAL_ERROR: 502,
  INTERNAL_ERROR: 500,
};
export class GatewayError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
