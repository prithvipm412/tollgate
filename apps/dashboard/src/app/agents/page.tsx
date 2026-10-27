"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Agent, AgentCreateResponse, Page } from "@tollgate/contracts";
import { api, message } from "../../lib/api";
import { Failure, Skeleton } from "../../components/ui";
import { Modal } from "../../components/modal";
export default function Agents() {
  const [items, setItems] = useState<Agent[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [copy, setCopy] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setItems(undefined);
    void api<Page<Agent>>("/agents", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setItems(data.items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [attempt]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const { api_key, ...agent } = await api<AgentCreateResponse>("/agents", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setItems((current) => [...(current ?? []), agent]);
      setSecret(api_key);
      setCopy("");
      form.reset();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(agent: Agent, action: "freeze" | "unfreeze" | "rotate-key") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (action === "rotate-key") {
        const { api_key, ...updated } = await api<AgentCreateResponse>(
          `/agents/${agent.id}/${action}`,
          { method: "POST" },
        );
        setItems((current) => current?.map((item) => (item.id === agent.id ? updated : item)));
        setSecret(api_key);
        setCopy("");
      } else {
        const updated = await api<Agent>(`/agents/${agent.id}/${action}`, { method: "POST" });
        setItems((current) => current?.map((item) => (item.id === agent.id ? updated : item)));
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function copyKey() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("Copied.");
    } catch {
      setCopy("Could not copy. Select and copy the key manually.");
    }
  }
  return (
    <section className="space-y-6">
      <h1>Agents</h1>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-4">
        <label className="flex-1 space-y-2">
          <span>Agent name</span>
          <input name="name" required maxLength={100} disabled={busy || !items} />
        </label>
        <button disabled={busy || !items}>{busy ? "Saving…" : "Create agent"}</button>
      </form>
      {error && <Failure text={error} retry={() => setAttempt((value) => value + 1)} />}{" "}
      {!items ? (
        !error && <Skeleton />
      ) : !items.length ? (
        <p className="card">No agents yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((agent) => (
            <li className="card space-y-3" key={agent.id}>
              <h2>{agent.name}</h2>
              <p className="muted">
                {agent.status} · {agent.key_prefix}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(agent, agent.status === "frozen" ? "unfreeze" : "freeze")
                  }
                >
                  {agent.status === "frozen" ? "Unfreeze" : "Freeze"}
                </button>
                <button disabled={busy} onClick={() => void mutate(agent, "rotate-key")}>
                  Rotate key
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {secret && (
        <Modal
          title="Save your API key"
          close={() => {
            setSecret("");
            setCopy("");
          }}
        >
          <p>
            This key is shown once and will not be shown again. Store it securely before closing.
          </p>
          <input
            aria-label="One-time API key"
            readOnly
            value={secret}
            onFocus={(event) => event.target.select()}
          />
          <p role="status">{copy}</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => void copyKey()}>Copy key</button>
            <button
              onClick={() => {
                setSecret("");
                setCopy("");
              }}
            >
              I saved the key
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
