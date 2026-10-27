"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  TollgateEventSchema,
  moneyToCents,
  type ActionRecord,
  type Page,
  type StatsOverview,
} from "@tollgate/contracts";
import { api, message } from "../../lib/api";
import { currency, mergeActions } from "../../lib/feed";
import { Failure, Skeleton, VerdictChip } from "../../components/ui";
export default function Overview() {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [stats, setStats] = useState<StatsOverview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [attempt, setAttempt] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setStatsError("");
    async function loadStats() {
      try {
        const data = await api<StatsOverview>("/stats/overview", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setStats(data);
          setStatsError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) setStatsError(message(error));
      }
    }
    const stream = new EventSource("/v1/events");
    // Keep this instance alive: native reconnect sends the last SSE id as Last-Event-ID.
    stream.onopen = () => {
      setConnection("Live");
      void loadStats();
    };
    stream.onerror = () => setConnection("Connection interrupted · reconnecting automatically");
    const receive = (raw: MessageEvent<string>) => {
      try {
        const event = TollgateEventSchema.parse(JSON.parse(raw.data));
        if ("request" in event.payload)
          setActions((current) => mergeActions(current, [event.payload as ActionRecord]));
        void loadStats();
      } catch {
        setConnection("Invalid event received · waiting for next update");
      }
    };
    for (const type of [
      "action.received",
      "action.decided",
      "action.executed",
      "action.failed",
      "approval.created",
      "approval.resolved",
    ])
      stream.addEventListener(type, receive as EventListener);
    void api<Page<ActionRecord>>("/actions", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setActions((current) => mergeActions(current, data.items));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void loadStats();
    return () => {
      controller.abort();
      stream.close();
    };
  }, [attempt]);
  const retry = () => setAttempt((value) => value + 1);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="muted mb-2">PAYMENT OVERSIGHT</p>
          <h1>Overview</h1>
        </div>
        <p role="status" className="text-sm text-slate-300">
          ● {connection}
        </p>
      </div>
      {statsError ? (
        <Failure text={statsError} retry={retry} />
      ) : !stats ? (
        <Skeleton />
      ) : (
        <section
          aria-label="Today's statistics"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            ["Allowed today", stats.counts_by_verdict.allow, "text-allow"],
            ["Held today", stats.counts_by_verdict.hold, "text-hold"],
            ["Blocked today", stats.counts_by_verdict.block, "text-block"],
            ["Money protected", currency(stats.money_protected_cents), "text-white"],
          ].map(([label, value, color]) => (
            <div key={label} className="card">
              <p className="muted">{label}</p>
              <p className={`mt-4 text-3xl font-semibold ${color}`}>{value}</p>
            </div>
          ))}
        </section>
      )}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2>Action feed</h2>
          <span className="muted">Latest 100 requests</span>
        </div>
        {error ? (
          <Failure text={error} retry={retry} />
        ) : loading ? (
          <Skeleton />
        ) : actions.length === 0 ? (
          <div className="card muted">No actions yet. New requests will appear here.</div>
        ) : (
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {actions.map((action) => (
                <motion.li
                  layout={!reduced}
                  key={action.request.action_id}
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                >
                  <Link
                    href={`/actions/${action.request.action_id}`}
                    className="card flex flex-wrap items-center justify-between gap-4 transition-colors hover:border-accent/50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {action.request.counterparty?.display_name ??
                          action.request.counterparty?.value ??
                          "Checkout order"}
                      </p>
                      <p className="muted mt-1">
                        {action.request.kind.replaceAll("_", " ")} ·{" "}
                        {action.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-medium">
                        {currency(moneyToCents(action.request.amount))}
                      </span>
                      <VerdictChip verdict={action.decision?.verdict} />
                    </div>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}
