import { describe, expect, it, vi } from "vitest";
import {
  PolicyCompileResponseSchema,
  type LlmClient,
  type PolicyCompileResponse,
} from "@tollgate/contracts";
import { compilePolicy } from "./index.js";

const draft: PolicyCompileResponse = {
  policy: {
    version: 1,
    kinds_allowed: ["payout"],
    limits: {},
    approval: { require_above: { currency: "USD", value: "300.00" }, new_counterparty: true },
    counterparties: {},
    categories: {},
    velocity: {},
  },
  explanation: [
    "Only payouts are allowed.",
    "Payments above $300 and payments to new counterparties require approval.",
  ],
  warnings: ["'a reasonable amount' has no numeric threshold."],
};
function fake(value: unknown = draft): LlmClient {
  return {
    completeJson: async <T>({ schema }: Parameters<LlmClient["completeJson"]>[0]) =>
      schema.parse(value) as T,
  };
}

describe("compilePolicy", () => {
  it("requests validated drafts with examples and ambiguity warnings", async () => {
    const llm = fake();
    const call = vi.spyOn(llm, "completeJson");
    const instruction =
      "Pay contractors up to a reasonable amount; hold above $300 and first-time recipients.";
    expect(await compilePolicy(instruction, llm)).toEqual(draft);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]![0]).toMatchObject({
      user: instruction,
      schema: PolicyCompileResponseSchema,
      timeoutMs: 30_000,
    });
    const system = call.mock.calls[0]![0].system;
    expect(system).toContain("Examples:");
    expect(system).toContain("BLOCK");
    expect(system).toContain("HOLD");
    expect(system).toContain("ambiguous phrases");
  });

  it.each([
    {},
    { ...draft, policy: { ...draft.policy, kinds_allowed: [] } },
    { ...draft, explanation: [] },
  ])("rejects malformed drafts", async (value) => {
    await expect(compilePolicy("Pay contractors.", fake(value))).rejects.toBeInstanceOf(Error);
  });

  it("revalidates responses from custom clients", async () => {
    const llm: LlmClient = { completeJson: async <T>() => ({ policy: {} }) as T };
    await expect(compilePolicy("Pay contractors.", llm)).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it.each(["LlmTimeoutError", "LlmValidationError", "LlmProviderError"])(
    "propagates %s without additional retries",
    async (name) => {
      const error = Object.assign(new Error("completion failed"), { name });
      const completeJson = vi.fn().mockRejectedValue(error);
      await expect(compilePolicy("Pay contractors.", { completeJson })).rejects.toBe(error);
      expect(completeJson).toHaveBeenCalledOnce();
    },
  );

  it.each(["", "x".repeat(4001)])(
    "rejects invalid instructions before calling the client",
    async (instruction) => {
      const llm = fake();
      const call = vi.spyOn(llm, "completeJson");
      await expect(compilePolicy(instruction, llm)).rejects.toMatchObject({ name: "ZodError" });
      expect(call).not.toHaveBeenCalled();
    },
  );
});
