import { ApiRequestError } from "./api";
export function secondsLeft(expires: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expires) - now) / 1000));
}
export function terminalLinkError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    ["INVALID_TOKEN", "APPROVAL_EXPIRED", "APPROVAL_ALREADY_RESOLVED"].includes(error.error.code)
  );
}
