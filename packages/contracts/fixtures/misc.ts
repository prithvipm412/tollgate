import type { ApiError, PolicyCompileRequest, PolicyCompileResponse } from "../src/index.js";
import { policyDocument } from "./mandates.js";

export const policyCompileRequest: PolicyCompileRequest = {
  instruction:
    "Pay our freelance contractors their invoiced amounts automatically, up to $300 per payment. Hold anything above $300, or to anyone we haven't paid before, for my approval.",
};

export const policyCompileResponse: PolicyCompileResponse = {
  policy: policyDocument,
  explanation: [
    "Auto-approve payouts, refunds, and invoices up to $300 per action.",
    "Hold for your approval anything over $300, or sent to someone never paid before.",
    "Block payments to known temporary/disposable email domains.",
    "Allow up to 10 actions per hour, Monday–Friday, 8am–8pm America/New_York.",
  ],
  warnings: ["No weekly/monthly cap was mentioned — defaulted to $4,000/week and $12,000/month."],
};

export const apiErrorExample: ApiError = {
  code: "VALIDATION_ERROR",
  message: "amount.value must be a non-negative decimal with exactly 2 decimal places",
  details: { field: "amount.value", received: "12.5" },
};
