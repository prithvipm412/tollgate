import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";
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
            className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"
          >
            <Link href="/overview" className="text-xl font-semibold tracking-tight">
              ◈ Tollgate
            </Link>
            <div className="flex gap-6 text-sm">
              <Link href="/overview">Overview</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
