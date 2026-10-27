import type { Finding, Verdict } from "./action.js";

/**
 * Combines findings from the policy engine and AI guard into one verdict.
 * Severity order is block > hold > allow. Because this only ever looks for the
 * worst finding present, appending more findings (e.g. AI guard findings onto
 * policy findings) can only raise the verdict, never relax it — satisfying
 * ADR 0002 (AI may only escalate).
 */
export function combineVerdicts(findings: Finding[]): Verdict {
  let worst: Verdict = "allow";
  for (const finding of findings) {
    if (finding.severity === "block") return "block";
    if (finding.severity === "hold") worst = "hold";
  }
  return worst;
}
