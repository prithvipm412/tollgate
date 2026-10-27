import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";
import { KillSwitch } from "../components/kill-switch";
const inter = Inter({ subsets: ["latin"] });
export const metadata = {
  title: "Tollgate | Operator console",
  description: "Oversight for AI payments",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="border-b border-white/10">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-6 py-5"
          >
            <Link
              href="/overview"
              className="shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight"
            >
              ◈ Tollgate
            </Link>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="/overview">Overview</Link>
              <Link href="/approvals">Approvals</Link>
              <Link href="/agents">Agents</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </nav>
        </header>
        <KillSwitch />
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
