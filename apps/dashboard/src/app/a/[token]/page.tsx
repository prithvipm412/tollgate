"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { moneyToCents, type ApprovalLinkView, type ApprovalRequest } from "@tollgate/contracts";
import { api, message } from "../../../lib/api";
import { secondsLeft, terminalLinkError } from "../../../lib/approval";
import { currency } from "../../../lib/feed";
import { Failure, Skeleton } from "../../../components/ui";
export default function ApprovalLink() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<ApprovalLinkView>();
  const [terminal, setTerminal] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined);
    setTerminal("");
    setError("");
    void api<ApprovalLinkView>(`/approval-links/${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setView(data);
          setNow(Date.now());
          if (data.status !== "pending") setTerminal(`Request ${data.status}.`);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (terminalLinkError(error))
            setTerminal("This link has expired or has already been used.");
          else setError(message(error));
        }
      });
    return () => controller.abort();
  }, [token, attempt]);
  const remaining = view ? secondsLeft(view.expires_at, now) : 0;
  async function resolve(decision: "approve" | "deny") {
    if (!view || busy || terminal || secondsLeft(view.expires_at, Date.now()) === 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<ApprovalRequest>(`/approval-links/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setTerminal(`Request ${result.status}. This link can no longer be used.`);
    } catch (error) {
      if (terminalLinkError(error)) setTerminal("This link has expired or has already been used.");
      else setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-lg space-y-6">
      <p className="muted">ONE-TIME PAYMENT REVIEW</p>
      <h1>Payment approval</h1>
      {terminal || (view && remaining === 0) ? (
        <div role="status" className="card">
          <h2>{terminal || "This approval link has expired."}</h2>
          <p className="muted mt-3">No further decision can be submitted from this page.</p>
        </div>
      ) : !view ? (
        error ? (
          <Failure text={error} retry={() => setAttempt((value) => value + 1)} />
        ) : (
          <Skeleton />
        )
      ) : (
        <>
          <div className="card space-y-4">
            <p className="text-4xl font-semibold">{currency(moneyToCents(view.amount))}</p>
            <p>
              {view.agent_name} · {view.kind.replaceAll("_", " ")}
            </p>
            {view.payee && (
              <p className="break-words">Payee: {view.payee.display_name ?? view.payee.value}</p>
            )}
            <p>{view.reason}</p>
            <ul className="space-y-3">
              {view.findings.map((finding, i) => (
                <li key={`${finding.code}-${i}`}>
                  <span className="text-sm text-hold">
                    {finding.source} · {finding.severity}
                  </span>
                  <p>{finding.message}</p>
                </li>
              ))}
            </ul>
            <p className="text-hold" aria-label="Time remaining">
              Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 grid grid-cols-2 gap-3 rounded-xl bg-base/95 py-3 backdrop-blur-xl">
            <button
              className="min-h-16 text-lg"
              disabled={busy}
              onClick={() => void resolve("approve")}
            >
              {busy ? "Submitting…" : "Approve"}
            </button>
            <button
              className="min-h-16 bg-block text-lg"
              disabled={busy}
              onClick={() => void resolve("deny")}
            >
              Deny
            </button>
          </div>
        </>
      )}
    </section>
  );
}
