"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApprovalRequest, Page } from "@tollgate/contracts";
import { api, message } from "../../lib/api";
import { Failure, Skeleton } from "../../components/ui";
export default function Approvals() {
  const [items, setItems] = useState<ApprovalRequest[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setItems(undefined);
    void api<Page<ApprovalRequest>>("/approvals?status=pending", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setItems(data.items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [attempt]);
  async function resolve(id: string, decision: "approve" | "deny") {
    if (busy) return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const resolved = await api<ApprovalRequest>(`/approvals/${id}/${decision}`, {
        method: "POST",
      });
      setItems((current) => current?.filter((item) => item.id !== id));
      setNotice(`Request ${resolved.status}.`);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="space-y-6">
      <h1>Approvals</h1>
      <p className="muted">Review held payments before they can proceed.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <Failure text={error} retry={() => setAttempt((value) => value + 1)} />}{" "}
      {!items ? (
        !error && <Skeleton />
      ) : items.length === 0 ? (
        <p className="card">No pending approvals.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="card space-y-4">
              <Link href={`/actions/${item.action_id}`} className="block break-all text-blue-300">
                Review action {item.action_id}
              </Link>
              <p className="muted">Expires {new Date(item.expires_at).toLocaleString()}</p>
              <div className="flex gap-3">
                <button disabled={!!busy} onClick={() => void resolve(item.id, "approve")}>
                  {busy === item.id ? "Resolving…" : "Approve"}
                </button>
                <button
                  disabled={!!busy}
                  className="bg-block"
                  onClick={() => void resolve(item.id, "deny")}
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
