"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type { UserRole } from "@/types/next-auth";
import type { BranchOption } from "@/lib/branchScope";

const RETAIL_LINKS = [
  { href: "/pos", label: "Point of Sale" },
  { href: "/products", label: "Catalog" },
  { href: "/reports", label: "Reports" },
];

const ADMIN_LINKS = [
  { href: "/staff", label: "Staff" },
  { href: "/branches", label: "Branches" },
];
const STORE_LINKS = [{ href: "/store", label: "Bulk Store" }];
const ADMIN_STORE_LINKS = [{ href: "/stores", label: "Stores" }];

export default function NavBar({
  pharmacyName,
  logoUrl,
  userName,
  userRole,
  branches,
  activeBranchId,
  scopeLabel,
}: {
  pharmacyName: string;
  logoUrl: string;
  userName: string;
  userRole: UserRole;
  branches: BranchOption[];
  activeBranchId: string | null;
  scopeLabel?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    ...(userRole === "admin" || userRole === "staff" ? RETAIL_LINKS : []),
    ...(userRole === "admin" ? ADMIN_LINKS : []),
    ...(userRole === "admin" || userRole === "store_manager" || userRole === "store_keeper" ? STORE_LINKS : []),
    ...(userRole === "admin" ? ADMIN_STORE_LINKS : []),
  ];

  function switchBranch(branchId: string) {
    document.cookie = `activeBranchId=${branchId}; path=/; max-age=31536000`;
    router.refresh();
  }

  const branchSwitcher =
    userRole === "admin" && branches.length > 0 ? (
      <select
        value={activeBranchId ?? ""}
        onChange={(e) => switchBranch(e.target.value)}
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
            <div className="mt-2 flex items-center justify-between border-t border-zinc-200 px-1 pt-3">
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
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
