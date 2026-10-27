"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Verdict } from "@tollgate/contracts";
export function VerdictChip({ verdict }: { verdict?: Verdict }) {
  const reduced = useReducedMotion();
  const colors = {
    allow: "bg-allow/15 text-allow",
    hold: "bg-hold/15 text-hold",
    block: "bg-block/15 text-block",
  };
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={verdict ?? "pending"}
        initial={reduced ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${verdict ? colors[verdict] : "bg-white/10 text-slate-300"}`}
      >
        {verdict ?? "Evaluating"}
      </motion.span>
    </AnimatePresence>
  );
}
export function Skeleton() {
  return (
    <div role="status" aria-label="Loading" className="card animate-pulse space-y-4">
      <div className="h-5 w-1/3 rounded bg-white/10" />
      <div className="h-16 rounded bg-white/5" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
export function Failure({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div role="alert" className="card space-y-4">
      <p className="text-red-300">{text}</p>
      <button onClick={retry}>Retry</button>
    </div>
  );
}
