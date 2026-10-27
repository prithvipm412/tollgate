"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, message } from "../../lib/api";
export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const password = new FormData(event.currentTarget).get("password");
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      router.push("/overview");
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto mt-12 max-w-md space-y-6">
      <p className="text-sm uppercase tracking-widest text-accent">Operator access</p>
      <h1>Every payment. Under control.</h1>
      <p className="muted">Sign in to review agent decisions and payment activity.</p>
      <form onSubmit={submit} className="card space-y-5" aria-busy={busy}>
        <label className="block space-y-2">
          <span>Admin password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        <button disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
