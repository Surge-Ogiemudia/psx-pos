"use client";

import { useRouter } from "next/navigation";

export default function BackButton({ label = "Back", fallbackHref }: { label?: string; fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else if (fallbackHref) router.push(fallbackHref);
      }}
      className="mb-3 flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900"
    >
      ← {label}
    </button>
  );
}
