"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { moneyToCents, type ActionRecord } from "@tollgate/contracts";
import { api, message } from "../../../lib/api";
import { currency } from "../../../lib/feed";
import { Failure, Skeleton, VerdictChip } from "../../../components/ui";
export default function ActionDetail() {
  const { id } = useParams<{ id: string }>();
  const [action, setAction] = useState<ActionRecord>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAction(undefined);
    setError("");
    void api<ActionRecord>(`/actions/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setAction(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [id, attempt]);
  const held = action?.decision?.verdict === "hold";
  return (
    <div className="space-y-8">
      <Link href="/overview" className="text-sm text-blue-300">
        ← Overview
      </Link>
      <h1>Action timeline</h1>
      {error ? (
        <Failure text={error} retry={() => setAttempt((value) => value + 1)} />
      ) : !action ? (
        <Skeleton />
      ) : (
        <>
          <div className="card flex flex-wrap justify-between gap-4">
            <div>
              <h2>
                {currency(moneyToCents(action.request.amount))} ·{" "}
                {action.request.kind.replaceAll("_", " ")}
              </h2>
              <p className="muted mt-2 break-all">{action.request.action_id}</p>
              <p className="muted mt-2">Status: {action.status.replaceAll("_", " ")}</p>
            </div>
            <VerdictChip verdict={action.decision?.verdict} />
          </div>
          <ol className="space-y-4">
            <li className="card">
              <h2>01 · Request received</h2>
              <p className="muted mt-1">{new Date(action.created_at).toLocaleString()}</p>
              <p className="mt-4">{action.request.reason}</p>
              {action.request.counterparty && (
                <p className="muted mt-2 break-all">
                  Counterparty: {action.request.counterparty.value}
                </p>
              )}
              <p className="muted mt-2 break-all">Agent: {action.agent_id}</p>
              {action.request.memo && <p className="mt-2">{action.request.memo}</p>}
            </li>
            <li className="card">
              <h2>02 · Findings</h2>
              {!action.decision ? (
                <p className="muted mt-3">Evaluation pending.</p>
              ) : action.decision.findings.length === 0 ? (
                <p className="muted mt-3">No findings reported.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {action.decision.findings.map((finding, index) => (
                    <li key={`${finding.code}-${index}`}>
                      <p className="text-sm text-blue-300">
                        {finding.source} · {finding.severity} · {finding.code}
                      </p>
                      <p className="mt-1">{finding.message}</p>
                      {finding.evidence && (
                        <blockquote className="mt-2 border-l-2 border-white/20 pl-3 text-sm text-slate-400 whitespace-pre-wrap">
                          {finding.evidence}
                        </blockquote>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li className="card">
              <h2>03 · Decision</h2>
              {action.decision ? (
                <>
                  <p className="mt-3">
                    {action.decision.verdict.toUpperCase()} · Risk {action.decision.risk_score}/100
                    · Policy v{action.decision.policy_version}
                  </p>
                  <p className="muted mt-2">
                    {new Date(action.decision.decided_at).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="muted mt-3">Awaiting policy and guard evaluation.</p>
              )}
            </li>
            {held && (
              <li className="card">
                <h2>04 · Human approval</h2>
                <p className="mt-3">
                  {action.status === "pending_approval"
                    ? "Awaiting human approval."
                    : ["denied", "expired"].includes(action.status)
                      ? `Approval ${action.status}.`
                      : "This request required human approval. Current action status: " +
                        action.status.replaceAll("_", " ")}
                </p>
                <p className="muted mt-2">
                  Approval identity and resolution timestamp are not included in the action record.
                </p>
              </li>
            )}
            <li className="card">
              <h2>{held ? "05" : "04"} · PayPal execution</h2>
              <p className="mt-3">
                {action.status === "executed"
                  ? "Executed in PayPal sandbox."
                  : action.status === "executing"
                    ? "Execution in progress."
                    : action.status === "failed"
                      ? "Execution failed."
                      : "No PayPal execution recorded."}
              </p>
              {action.paypal_resource_id && (
                <p className="mt-2 break-all font-mono text-sm text-blue-300">
                  {action.paypal_resource_id}
                </p>
              )}
              {action.error && (
                <p role="alert" className="mt-2 text-red-300">
                  {action.error}
                </p>
              )}
              <p className="muted mt-2">
                Last updated {new Date(action.updated_at).toLocaleString()}
              </p>
            </li>
          </ol>
        </>
      )}
    </div>
  );
}
