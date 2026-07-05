"use client";

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
}: {
  pharmacyName: string;
  logoUrl: string;
  userName: string;
  userRole: UserRole;
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
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

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={pharmacyName} className="h-8 w-8 rounded object-contain" />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded text-sm font-bold text-white"
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              {pharmacyName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-semibold text-zinc-900">{pharmacyName}</span>
        </div>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
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

        <div className="flex items-center gap-3">
          {userRole === "admin" && branches.length > 0 && (
            <select
              value={activeBranchId ?? ""}
              onChange={(e) => switchBranch(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              title="Branch you're currently managing"
            >
              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.branchName}
                </option>
              ))}
            </select>
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
      </div>
    </header>
  );
}
