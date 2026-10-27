"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  title,
  children,
  close,
  full = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  full?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-label={title}
      className={
        full
          ? "fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none border-0 bg-base p-6 text-slate-100 backdrop:bg-base"
          : "card w-[calc(100%-2rem)] max-w-lg text-slate-100 backdrop:bg-black/70"
      }
    >
      <h2>{title}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </dialog>
  );
}
