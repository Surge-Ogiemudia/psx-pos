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

const STORE_LINKS = [{ href: "/store", label: "Bulk Store" }];

// Less-frequently-used, admin-only management pages — tucked behind the "Admin" menu
// instead of sitting in the main row, so the nav doesn't wrap once admin has both
// retail and store links too.
const ADMIN_MENU_LINKS = [
  { href: "/staff", label: "Staff" },
  { href: "/branches", label: "Branches" },
  { href: "/stores", label: "Stores" },
];

// The branch switcher only makes sense on pages that are actually branch-scoped —
// showing it on Bulk Store pages (which aren't) was confusing.
const RETAIL_PATHS = ["/pos", "/products", "/reports"];

export default function NavBar({
  pharmacyName,
  logoUrl,
  userName,
  userRole,
  branches,
  activeBranchId,
  activeBranchName,
  activeStoreName,
}: {
  pharmacyName: string;
  logoUrl: string;
  userName: string;
  userRole: UserRole;
  branches: BranchOption[];
  activeBranchId: string | null;
  activeBranchName?: string | null;
  activeStoreName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  // Staff/store keeper are locked to one place — always show it, so it's never ambiguous
  // which branch or store a login is scoped to.
  const locationLabel =
    userRole === "staff" && activeBranchName
      ? `Branch: ${activeBranchName}`
      : userRole === "store_keeper" && activeStoreName
        ? `Store: ${activeStoreName}`
        : null;

  const links = [
    ...(userRole === "admin" || userRole === "staff" ? RETAIL_LINKS : []),
    ...(userRole === "admin" || userRole === "store_manager" || userRole === "store_keeper" ? STORE_LINKS : []),
  ];
  const isRetailPath = RETAIL_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  function switchBranch(branchId: string) {
    document.cookie = `activeBranchId=${branchId}; path=/; max-age=31536000`;
    router.refresh();
  }

  const branchSwitcher =
    userRole === "admin" && isRetailPath && branches.length > 0 ? (
      <label className="flex items-center gap-1.5 text-sm text-zinc-500">
        Branch:
        <select
          value={activeBranchId ?? ""}
          onChange={(e) => switchBranch(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900"
        >
          {branches.map((branch) => (
            <option key={branch._id} value={branch._id}>
              {branch.branchName}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  function linkClass(href: string) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "text-white" : "text-zinc-600 hover:bg-zinc-100"
    }`;
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
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

        {/* Centered regardless of how wide the logo or the user cluster are, on either side. */}
        <nav className="hidden items-center gap-1 md:absolute md:left-1/2 md:flex md:-translate-x-1/2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              {link.label}
            </Link>
          ))}
          {userRole === "admin" && (
            <div className="relative">
              <button
                onClick={() => setAdminMenuOpen((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  adminMenuOpen ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                Admin ▾
              </button>
              {adminMenuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label="Close menu"
                    onClick={() => setAdminMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 flex w-40 flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
                    {ADMIN_MENU_LINKS.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setAdminMenuOpen(false)}
                        className={linkClass(link.href) + " block"}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </nav>

        <div className="hidden items-center gap-3 md:ml-auto md:flex">
          {branchSwitcher}
          {locationLabel && (
            <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
              {locationLabel}
            </span>
          )}
          <span className="text-sm text-zinc-500">
            {userName} <span className="text-zinc-400">({userRole})</span>
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>

        {menuOpen && (
          <div className="order-last flex w-full flex-col gap-1 border-t border-zinc-200 pt-3 md:hidden">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={linkClass(link.href) + " block"}
              >
                {link.label}
              </Link>
            ))}
            {userRole === "admin" && ADMIN_MENU_LINKS.length > 0 && (
              <>
                <div className="mt-1 border-t border-zinc-100 pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Admin
                </div>
                {ADMIN_MENU_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={linkClass(link.href) + " block"}
                  >
                    {link.label}
                  </Link>
                ))}
              </>
            )}
            {branchSwitcher && <div className="px-1 pt-2">{branchSwitcher}</div>}
            {locationLabel && (
              <div className="px-1 pt-2">
                <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
                  {locationLabel}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-zinc-200 px-1 pt-3">
              <span className="text-sm text-zinc-500">
                {userName} <span className="text-zinc-400">({userRole})</span>
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
