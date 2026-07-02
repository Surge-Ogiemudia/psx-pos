"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const LINKS = [
  { href: "/pos", label: "Point of Sale" },
  { href: "/products", label: "Catalog" },
  { href: "/reports", label: "Reports" },
];

const ADMIN_LINKS = [{ href: "/staff", label: "Staff" }];

export default function NavBar({
  pharmacyName,
  logoUrl,
  userName,
  userRole,
}: {
  pharmacyName: string;
  logoUrl: string;
  userName: string;
  userRole: "admin" | "staff";
}) {
  const pathname = usePathname();
  const links = userRole === "admin" ? [...LINKS, ...ADMIN_LINKS] : LINKS;

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
