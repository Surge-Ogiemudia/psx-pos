"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type { UserRole } from "@/types/next-auth";
import type { BranchOption } from "@/lib/branchScope";
import type { StoreOption } from "@/lib/storeScope";

const RETAIL_LINKS = [
  { href: "/pos", label: "Point of Sale" },
  { href: "/dispensary", label: "Dispensary" },
  { href: "/products", label: "Catalog" },
  { href: "/reports", label: "Reports" },
];

const ADMIN_LINKS = [
  { href: "/staff", label: "Staff" },
  { href: "/locations", label: "Locations" },
];
const STORE_LINKS = [{ href: "/store", label: "Bulk Store" }];

interface Pending {
  kind: "branch" | "store";
  id: string;
  name: string;
  currentName: string;
}

export default function NavBar({
  pharmacyName,
  logoUrl,
  userName,
  userRole,
  branches,
  activeBranchId,
  stores,
  activeStoreId,
  scopeLabel,
}: {
  pharmacyName: string;
  logoUrl: string;
  userName: string;
  userRole: UserRole;
  branches: BranchOption[];
  activeBranchId: string | null;
  stores: StoreOption[];
  activeStoreId: string | null;
  scopeLabel?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [emrToken, setEmrToken] = useState<string | null>(null);
  const [isEmrOpen, setIsEmrOpen] = useState(false);
  const links = [
    ...(userRole === "admin" || userRole === "staff" ? RETAIL_LINKS : []),
    ...(userRole === "admin" ? ADMIN_LINKS : []),
    ...(userRole === "admin" || userRole === "store_manager" || userRole === "store_keeper" ? STORE_LINKS : []),
  ];

  function requestSwitch(kind: "branch" | "store", id: string, name: string, currentName: string) {
    if (id === (kind === "branch" ? activeBranchId : activeStoreId)) return;
    setPending({ kind, id, name, currentName });
  }

  function confirmSwitch() {
    if (!pending) return;
    const cookieName = pending.kind === "branch" ? "activeBranchId" : "activeStoreId";
    document.cookie = `${cookieName}=${pending.id}; path=/; max-age=31536000`;
    setPending(null);
    router.refresh();
  }

  const activeBranchName = branches.find((b) => b._id === activeBranchId)?.branchName ?? "";
  const activeStoreName = stores.find((s) => s._id === activeStoreId)?.storeName ?? "";

  const branchSwitcher =
    userRole === "admin" && branches.length > 0 ? (
      <select
        value={activeBranchId ?? ""}
        onChange={(e) => {
          const branch = branches.find((b) => b._id === e.target.value);
          if (branch) requestSwitch("branch", branch._id, branch.branchName, activeBranchName);
        }}
        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm md:w-auto"
        title="Branch you're currently managing"
      >
        {branches.map((branch) => (
          <option key={branch._id} value={branch._id}>
            {branch.branchName}
          </option>
        ))}
      </select>
    ) : null;

  const storeSwitcher =
    (userRole === "admin" || userRole === "store_manager") && stores.length > 0 ? (
      <select
        value={activeStoreId ?? ""}
        onChange={(e) => {
          const store = stores.find((s) => s._id === e.target.value);
          if (store) requestSwitch("store", store._id, store.storeName, activeStoreName);
        }}
        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm md:w-auto"
        title="Store you're currently managing"
      >
        {stores.map((store) => (
          <option key={store._id} value={store._id}>
            {store.storeName}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex items-center gap-4 py-3">
          <div className="flex flex-1 items-center gap-2 md:flex-none">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={pharmacyName} className="h-8 w-8 rounded object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-bold text-white"
                style={{ backgroundColor: "var(--brand-color)" }}
              >
                {pharmacyName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-zinc-900">{pharmacyName}</span>
          </div>

          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg border border-zinc-300 p-2 text-zinc-600 md:hidden"
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
              </svg>
            )}
          </button>

          <div className="hidden items-center gap-3 md:ml-auto md:flex">
            {branchSwitcher}
            {storeSwitcher}
            <span className="whitespace-nowrap text-sm text-zinc-500">
              {userName} <span className="text-zinc-400">({userRole})</span>
              {scopeLabel && (
                <>
                  {" "}
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                    {scopeLabel}
                  </span>
                </>
              )}
            </span>
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/api/auth/emr-sso", { method: "POST" });
                  const data = await res.json();
                  if (data.token) {
                    setEmrToken(data.token);
                    setIsEmrOpen(true);
                  }
                } catch (e) {
                  console.error("SSO failed", e);
                }
              }}
              className="whitespace-nowrap rounded-lg bg-teal-700 hover:bg-teal-800 px-3 py-1.5 text-sm font-medium text-white"
            >
              Connect to EMR
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="hidden flex-wrap items-center gap-1 border-t border-zinc-100 py-2 md:flex">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
                style={active ? { backgroundColor: "var(--brand-color)" } : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {menuOpen && (
          <div className="order-last flex w-full flex-col gap-1 border-t border-zinc-200 pt-3 pb-3 md:hidden">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    active ? "text-white" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                  style={active ? { backgroundColor: "var(--brand-color)" } : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            {branchSwitcher && <div className="px-1 pt-2">{branchSwitcher}</div>}
            {storeSwitcher && <div className="px-1 pt-2">{storeSwitcher}</div>}
            <div className="mt-2 flex flex-col gap-3 border-t border-zinc-200 px-1 pt-3 pb-2">
              <span className="text-sm text-zinc-500">
                {userName} <span className="text-zinc-400">({userRole})</span>
              {scopeLabel && (
                <>
                  {" "}
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                    {scopeLabel}
                  </span>
                </>
              )}
              </span>
              <div className="flex flex-col gap-2 w-full">
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      const res = await fetch("/api/auth/emr-sso", { method: "POST" });
                      const data = await res.json();
                      if (data.token) {
                        setEmrToken(data.token);
                        setIsEmrOpen(true);
                      }
                    } catch (e) {
                      console.error("SSO failed", e);
                    }
                  }}
                  className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 text-center"
                >
                  Connect to EMR
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 text-center"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
            <h2 className="mb-2 text-base font-semibold text-zinc-900">
              Switch {pending.kind === "branch" ? "branch" : "store"}?
            </h2>
            <p className="mb-4 text-sm text-zinc-600">
              You&apos;re about to leave <strong>{pending.currentName || "your current location"}</strong> and
              start managing <strong>{pending.name}</strong> instead. Everything you do afterward — stock,
              prices, sales — will apply to {pending.name}, not{" "}
              {pending.currentName || "where you are now"}.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={confirmSwitch}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                Yes, switch to {pending.name}
              </button>
              <button
                onClick={() => setPending(null)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isEmrOpen && emrToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-[480px] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col border border-zinc-200" style={{ height: "85vh" }}>
            <div className="flex justify-between items-center bg-zinc-50 px-4 py-3 border-b border-zinc-200">
              <span className="font-semibold text-zinc-800 text-sm">Pharmacy EMR Module</span>
              <button 
                onClick={() => setIsEmrOpen(false)}
                className="text-zinc-500 hover:text-zinc-800 text-lg font-bold"
              >
                ✕
              </button>
            </div>
            <iframe 
              src={`${window.location.hostname === "localhost" ? "http://localhost:3001" : window.location.origin.replace("pos", "emr")}/login-sso?token=${emrToken}`}
              className="flex-1 w-full border-0"
            />
          </div>
        </div>
      )}
    </header>
  );
}
