"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { KillSwitchStateSchema, type KillSwitchState } from "@tollgate/contracts";
import { api, message } from "../lib/api";
import { Modal } from "./modal";
export function KillSwitch() {
  const path = usePathname();
  const visible = path !== "/login" && !path.startsWith("/a/");
  const [state, setState] = useState<KillSwitchState>();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setState(undefined);
    setError("");
    const load = () =>
      void api<KillSwitchState>("/killswitch", { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) {
            setState(value);
            setError("");
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(message(error));
        });
    load();
    const stream = new EventSource("/v1/events");
    stream.onopen = load;
    const receive = (event: MessageEvent<string>) => {
      try {
        const parsed = KillSwitchStateSchema.parse(JSON.parse(event.data).payload);
        setState(parsed);
      } catch {
        load();
      }
    };
    stream.addEventListener("killswitch.changed", receive as EventListener);
    const timer = window.setInterval(load, 15000);
    return () => {
      controller.abort();
      stream.close();
      window.clearInterval(timer);
    };
  }, [visible, attempt]);
  async function toggle(engaged: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setState(
        await api<KillSwitchState>("/killswitch", {
          method: "POST",
          body: JSON.stringify({ engaged }),
        }),
      );
      setConfirm(false);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!visible) return null;
  return (
    <>
      <section
        aria-label="Global payment control"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-5"
      >
        <p className="muted">
          {state
            ? state.engaged
              ? "All agents paused"
              : "Payment controls active"
            : "Loading payment controls…"}
        </p>
        {!state && error ? (
          <button onClick={() => setAttempt((value) => value + 1)}>Retry control</button>
        ) : (
          <button
            disabled={!state || busy}
            onClick={() => setConfirm(true)}
            className="bg-block/20 text-red-200"
          >
            Pause all payments
          </button>
        )}
        {error && !state?.engaged && (
          <p role="alert" className="w-full text-red-300">
            {error}
          </p>
        )}
      </section>
      {confirm && !state?.engaged && (
        <Modal
          title="Pause all agent payments?"
          close={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            This engages the global kill switch. No new agent payments will be accepted until you
            resume.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button disabled={busy} onClick={() => void toggle(true)} className="bg-block">
              {busy ? "Pausing…" : "Confirm pause"}
            </button>
            <button disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {state?.engaged && (
        <Modal title="All payments paused" full close={() => {}}>
          <div className="grid min-h-[80vh] place-items-center">
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-block/10"
              animate={{ opacity: reduced ? 1 : [0.35, 1, 0.35] }}
              transition={{ duration: 4, repeat: reduced ? 0 : Infinity }}
            />
            <div className="relative max-w-lg space-y-6 text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-red-300">
                Global kill switch engaged
              </p>
              <h1 className="text-4xl sm:text-6xl">All payments paused.</h1>
              <p className="text-slate-300">
                Every agent is paused. Resume only when you are ready to accept new payment
                requests.
              </p>
              {state.reason && <p>{state.reason}</p>}
              {error && (
                <p role="alert" className="text-red-300">
                  {error}
                </p>
              )}
              <button autoFocus disabled={busy} onClick={() => void toggle(false)}>
                {busy ? "Resuming…" : "Resume payments"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
