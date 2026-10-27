import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { secondsLeft, terminalLinkError } from "./approval";
describe("one-time approval", () => {
  it("rounds up the countdown and clamps expired links", () => {
    const expiry = "2026-10-27T12:00:00Z";
    expect(secondsLeft(expiry, Date.parse(expiry) - 1001)).toBe(2);
    expect(secondsLeft(expiry, Date.parse(expiry))).toBe(0);
    expect(secondsLeft(expiry, Date.parse(expiry) + 5000)).toBe(0);
  });
  it("recognizes terminal API responses without hiding retryable failures", () => {
    for (const code of ["INVALID_TOKEN", "APPROVAL_EXPIRED", "APPROVAL_ALREADY_RESOLVED"] as const)
      expect(terminalLinkError(new ApiRequestError({ code, message: "Terminal" }, 410))).toBe(true);
    expect(
      terminalLinkError(new ApiRequestError({ code: "INTERNAL_ERROR", message: "Retry" }, 500)),
    ).toBe(false);
    expect(terminalLinkError(new TypeError("Network failure"))).toBe(false);
  });
});
