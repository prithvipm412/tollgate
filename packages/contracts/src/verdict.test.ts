import { describe, expect, it } from "vitest";
import { combineVerdicts } from "./verdict.js";
import type { Finding } from "./action.js";

function finding(severity: Finding["severity"]): Finding {
  return { source: "policy", code: "TEST_FINDING", severity, message: "test" };
}

describe("combineVerdicts", () => {
  it("allows when there are no findings", () => {
    expect(combineVerdicts([])).toBe("allow");
  });

  it("allows when only info/warn findings are present", () => {
    expect(combineVerdicts([finding("info"), finding("warn")])).toBe("allow");
  });

  it("holds when a hold finding is present and nothing worse", () => {
    expect(combineVerdicts([finding("info"), finding("hold"), finding("warn")])).toBe("hold");
  });

  it("blocks when any block finding is present, regardless of order", () => {
    expect(combineVerdicts([finding("hold"), finding("block"), finding("info")])).toBe("block");
    expect(combineVerdicts([finding("block")])).toBe("block");
  });

  it("is monotonic: appending findings never relaxes the verdict (AI may only escalate)", () => {
    const policyOnly: Finding[] = [finding("hold")];
    const withAiFindings: Finding[] = [...policyOnly, finding("info"), finding("warn")];
    expect(combineVerdicts(withAiFindings)).toBe(combineVerdicts(policyOnly));

    const withEscalation: Finding[] = [...policyOnly, finding("block")];
    expect(combineVerdicts(withEscalation)).toBe("block");
  });
});
