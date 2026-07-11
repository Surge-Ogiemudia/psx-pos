"use client";

import { useState, type ReactNode } from "react";

export default function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-900"
      >
        <span>{title}</span>
        <span className="text-xs font-normal text-zinc-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-zinc-100 p-4">{children}</div>}
    </div>
  );
}
