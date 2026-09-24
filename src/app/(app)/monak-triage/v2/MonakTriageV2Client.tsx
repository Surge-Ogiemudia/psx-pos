"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import ResilientThumb from "@/components/ResilientThumb";

// ---------------------------------------------------------------------------
// Types (mirror src/lib/triageV2/queue.ts)
// ---------------------------------------------------------------------------

type TabKey = "dup_priced" | "dup_unpriced" | "price";

interface Hint {
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

interface Member {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  category: string;
  quantityInStock: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  expiryDate: string | null;
  barcode: string;
  imageUrl: string | null;
  createdAt: string;
  unitsSoldEver: number;
  photos: { frontImageUrl: string | null; backImageUrl: string | null };
  hints: Hint[];
}

interface GroupFlags {
  brandDiffers: boolean;
  sizeDiffers: boolean;
  priceConflict: boolean;
  barcodeConflict: boolean;
}

interface GroupItem {
  groupId: string;
  groupKey: string;
  tier: string;
  hasPrice: boolean;
  flags: GroupFlags;
  computedAt: string;
  members: Member[];
}

interface PriceItem extends Member {
  reasons: string[];
}

type Counts = Record<TabKey, number>;

interface TabState {
  items: (GroupItem | PriceItem)[];
  nextCursor: string | null;
  loaded: boolean;
  error: string | null;
  loadingMore: boolean;
}

const EMPTY_TAB: TabState = { items: [], nextCursor: null, loaded: false, error: null, loadingMore: false };

const TABS: { key: TabKey; label: string }[] = [
  { key: "dup_priced", label: "1. Duplicates with a price" },
  { key: "dup_unpriced", label: "2. Duplicates without a price" },
  { key: "price", label: "3. Price & fixes" },
];

const STORAGE_KEY = "monakTriageV2Tab";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const naira = (n: number | string | null | undefined) => `₦${(Number(n) || 0).toLocaleString()}`;

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function toDateInput(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return t.toISOString().slice(0, 10);
}

const REASON_LABELS: Record<string, { label: string; cls: string }> = {
  no_price: { label: "No price", cls: "bg-red-50 text-red-700 border-red-200" },
  wholesale_above_retail: { label: "Wholesale above retail", cls: "bg-red-50 text-red-700 border-red-200" },
  unknown_brand: { label: "Unknown brand", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  no_size: { label: "No size", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function errText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return "You don't have access to Triage v2 yet";
  return e instanceof Error ? e.message : "Something went wrong";
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

function PhotoPair({ member, onZoom }: { member: Member; onZoom: (src: string) => void }) {
  const { frontImageUrl, backImageUrl } = member.photos;
  return (
    <div className="flex gap-2">
      <ResilientThumb
        src={frontImageUrl}
        alt="Front"
        label="Front"
        size={256}
        className="h-24 w-24"
        onClick={() => frontImageUrl && onZoom(frontImageUrl)}
      />
      <ResilientThumb
        src={backImageUrl}
        alt="Back"
        label="Back"
        size={256}
        className="h-24 w-24"
        onClick={() => backImageUrl && onZoom(backImageUrl)}
      />
    </div>
  );
}

function ZoomOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Photo zoom"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Full size" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-zinc-800 hover:bg-white"
      >
        Close (Esc)
      </button>
    </div>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function TabBar({
  tab,
  counts,
  onSelect,
}: {
  tab: TabKey;
  counts: Counts | null;
  onSelect: (t: TabKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3">
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
              active
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {t.label}
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                active ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {counts ? counts[t.key].toLocaleString() : "…"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group card (tabs 1 & 2)
// ---------------------------------------------------------------------------

interface MergeResponse {
  success: boolean;
  product?: Partial<Member>;
  quantityInStock: number;
  removedProductIds: string[];
  groupStatus: "open" | "resolved";
}

function pairKey(m: { retailPrice: number; wholesalePrice: number }) {
  return `${Number(m.retailPrice) || 0}/${Number(m.wholesalePrice) || 0}`;
}

function spellingScore(s: string) {
  const mixed = /[a-z]/.test(s) && /[A-Z]/.test(s) ? 1000 : 0;
  return mixed + s.trim().length;
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function best(values: string[]): string {
  const d = distinct(values);
  d.sort((a, b) => spellingScore(b) - spellingScore(a));
  return d[0] ?? "";
}

function barcodeScore(b: string) {
  if (!/^\d+$/.test(b)) return 0;
  return [8, 12, 13, 14].includes(b.length) ? 100 + b.length : b.length;
}

function GroupCard({
  group,
  branchId,
  onZoom,
  onMerged,
  onRemoved,
  compact = false,
  onSkip,
}: {
  compact?: boolean;
  onSkip?: () => void;
  group: GroupItem;
  branchId: string;
  onZoom: (src: string) => void;
  onMerged: (res: MergeResponse, group: GroupItem, keptId: string, fields: MergeFields) => void;
  onRemoved: (group: GroupItem) => void;
}) {
  const members = group.members;
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const included = members.filter((m) => !unchecked[m._id]);
  const n = included.length;

  // Overrides: undefined means "use the computed default".
  const [keptOverride, setKeptOverride] = useState<string | undefined>();
  const [ov, setOv] = useState<Partial<Record<"itemName" | "brand" | "size" | "category" | "retail" | "wholesale" | "distributor" | "barcode" | "expiry", string>>>({});
  const [stockMode, setStockMode] = useState<"add" | "keep_one">("add");
  const [keepFromOverride, setKeepFromOverride] = useState<string | undefined>();
  const [busy, setBusy] = useState<null | "merge" | "not_same">(null);
  const [error, setError] = useState<string | null>(null);

  // ---- defaults (derived from the included copies) ----
  const priced = included.filter((m) => Number(m.retailPrice) > 0);
  const pool = priced.length ? priced : included;
  const defaultKept = pool.length
    ? pool.reduce((a, b) => (Number(b.quantityInStock) > Number(a.quantityInStock) ? b : a))._id
    : "";
  const keptId = keptOverride && included.some((m) => m._id === keptOverride) ? keptOverride : defaultKept;

  const pairs = Array.from(new Set(priced.map(pairKey)));
  const priceConflict = pairs.length > 1;
  const singlePair = pairs.length === 1 ? priced.find((m) => pairKey(m) === pairs[0]) : undefined;

  const names = distinct(included.map((m) => m.itemName));
  const brands = distinct(included.map((m) => m.brand));
  const sizes = distinct(included.map((m) => m.size));
  const barcodes = distinct(included.map((m) => m.barcode)).sort((a, b) => barcodeScore(b) - barcodeScore(a));
  const expiries = included
    .map((m) => (m.expiryDate ? new Date(m.expiryDate).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const farthest = expiries.length ? new Date(Math.max(...expiries)).toISOString().slice(0, 10) : "";
  const keptMember = members.find((m) => m._id === keptId);
  const defaultDistributor =
    keptMember && Number(keptMember.distributorPrice) > 0
      ? keptMember.distributorPrice
      : included.find((m) => Number(m.distributorPrice) > 0)?.distributorPrice ?? 0;

  const itemName = ov.itemName ?? best(included.map((m) => m.itemName));
  const brand = ov.brand ?? best(included.map((m) => m.brand));
  const size = ov.size ?? best(included.map((m) => m.size));
  const category = ov.category ?? keptMember?.category ?? "supermarket";
  const retailStr = ov.retail ?? (singlePair ? String(singlePair.retailPrice) : "");
  const wholesaleStr = ov.wholesale ?? (singlePair ? String(singlePair.wholesalePrice) : "");
  const distributorStr = ov.distributor ?? String(defaultDistributor || "");
  const barcode = ov.barcode ?? barcodes[0] ?? "";
  const expiry = ov.expiry ?? farthest;

  const hints: Hint[] = [];
  for (const m of members) for (const h of m.hints ?? []) hints.push(h);

  // ---- stock ----
  const sum = included.reduce((s, m) => s + (Number(m.quantityInStock) || 0), 0);
  const stockCounts = included.map((m) => Number(m.quantityInStock) || 0);
  const identicalCounts = n >= 2 && new Set(stockCounts).size < stockCounts.length;
  const keepFromId =
    keepFromOverride && included.some((m) => m._id === keepFromOverride) ? keepFromOverride : defaultKept;
  const keepFrom = included.find((m) => m._id === keepFromId);
  const original = keepFrom ? (Number(keepFrom.quantityInStock) || 0) + (Number(keepFrom.unitsSoldEver) || 0) : 0;
  const keepOneResult = Math.max(0, sum - (n - 1) * original);
  const resultStock = stockMode === "add" ? sum : keepOneResult;

  // ---- validation ----
  const retail = numOrNull(retailStr);
  const wholesale = numOrNull(wholesaleStr);
  const distributor = numOrNull(distributorStr);
  const problems: string[] = [];
  if (n < 2) problems.push("Tick at least 2 copies to merge");
  if (!itemName.trim() || !brand.trim() || !size.trim()) problems.push("Name, brand and size are required");
  if (retail === null || wholesale === null) problems.push("Enter retail and wholesale prices");
  else {
    if (retail < 0 || wholesale < 0) problems.push("Prices cannot be negative");
    if (wholesale > retail) problems.push("Wholesale cannot exceed retail");
    if (retail > 0 && wholesale <= 0) problems.push("Wholesale must be above 0 when retail is set");
    if (!group.hasPrice && !(retail > 0)) problems.push("This group needs a real price");
  }
  if (priceConflict && (retail === null || !pairs.includes(`${retail}/${wholesale}`)) && ov.retail === undefined) {
    problems.push("Choose which price is right");
  }
  if (distributor !== null && distributor < 0) problems.push("Distributor price cannot be negative");
  const canMerge = problems.length === 0 && !busy;

  async function doMerge() {
    if (!canMerge || retail === null || wholesale === null) return;
    setBusy("merge");
    setError(null);
    const fields: MergeFields = {
      itemName: itemName.trim(),
      brand: brand.trim(),
      size: size.trim(),
      category,
      retailPrice: retail,
      wholesalePrice: wholesale,
      distributorPrice: distributor ?? 0,
      barcode: barcode.trim(),
      expiryDate: expiry || null,
    };
    try {
      const res = await post<MergeResponse>("/api/triage-v2/merge", {
        branchId,
        groupId: group.groupId,
        keptProductId: keptId,
        mergeProductIds: included.filter((m) => m._id !== keptId).map((m) => m._id),
        stockMode,
        ...(stockMode === "keep_one" ? { keepOneFromProductId: keepFromId } : {}),
        fields,
      });
      onMerged(res, group, keptId, fields);
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  }

  async function doNotSame() {
    if (busy) return;
    const ok = window.confirm(
      "Mark these products as NOT the same?\n\nThis is permanent: they will never be suggested as duplicates again."
    );
    if (!ok) return;
    setBusy("not_same");
    setError(null);
    try {
      await post("/api/triage-v2/not-same", { branchId, groupId: group.groupId });
      onRemoved(group);
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  }

  const set = (k: keyof typeof ov, v: string) => setOv((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      {/* header chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip cls="bg-blue-50 text-blue-700 border-blue-200">Tier: {group.tier.replace("_", " ")}</Chip>
        {group.flags?.brandDiffers && <Chip cls="bg-amber-50 text-amber-700 border-amber-200">Brands differ</Chip>}
        {group.flags?.sizeDiffers && <Chip cls="bg-amber-50 text-amber-700 border-amber-200">Sizes differ</Chip>}
        {group.flags?.priceConflict && <Chip cls="bg-red-50 text-red-700 border-red-200">Price conflict</Chip>}
        {group.flags?.barcodeConflict && <Chip cls="bg-red-50 text-red-700 border-red-200">Barcode conflict</Chip>}
        <span className="ml-auto text-xs text-zinc-400">{timeAgo(group.computedAt)}</span>
      </div>

      {/* copies side by side */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(members.length, 4)}, minmax(0, 1fr))` }}>
        {members.map((m) => {
          const isIncluded = !unchecked[m._id];
          const isKept = isIncluded && m._id === keptId;
          return (
            <div
              key={m._id}
              className={`rounded-xl border p-3 text-xs ${
                isIncluded ? (isKept ? "border-emerald-400 bg-emerald-50/40" : "border-zinc-200") : "border-dashed border-zinc-300 opacity-50"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-zinc-700">
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={(e) => setUnchecked((p) => ({ ...p, [m._id]: !e.target.checked }))}
                  />
                  Include
                </label>
                {isKept && <Chip cls="bg-emerald-100 text-emerald-700 border-emerald-200">Kept</Chip>}
              </div>
              <PhotoPair member={m} onZoom={onZoom} />
              <div className="mt-2 space-y-0.5">
                <div className="text-sm font-bold text-zinc-900">{m.itemName}</div>
                <div className="text-zinc-600">
                  {m.brand || "—"} · {m.size || "—"}
                </div>
                <div className="text-zinc-500">{m.category}</div>
                <div className="text-zinc-800">
                  Stock: <b>{m.quantityInStock}</b> · Sold: <b>{m.unitsSoldEver}</b>
                </div>
                <div className="text-zinc-800">
                  Retail {naira(m.retailPrice)} / Wholesale {naira(m.wholesalePrice)}
                </div>
                <div className="text-zinc-500">
                  Expiry: {m.expiryDate ? toDateInput(m.expiryDate) : "—"}
                </div>
                <div className="break-all font-mono text-zinc-500">{m.barcode || "no barcode"}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* merge form */}
      <div className={`mt-4 grid gap-4 rounded-xl bg-zinc-50 p-3 ${compact ? "" : "lg:grid-cols-2"}`}>
        <div className="space-y-3">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-zinc-600">Keep this copy (record that survives)</legend>
            <div className="flex flex-wrap gap-3">
              {included.map((m, i) => (
                <label key={m._id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={`kept-${group.groupId}`}
                    checked={m._id === keptId}
                    onChange={() => setKeptOverride(m._id)}
                  />
                  Copy {members.indexOf(m) + 1 || i + 1} ({m.quantityInStock} in stock)
                </label>
              ))}
            </div>
          </fieldset>

          <details open={!compact} className="rounded-lg border border-zinc-200 bg-white p-2">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-600">
              Edit details: {itemName} · {brand} · {size} · {category} · {barcode || "no barcode"}
            </summary>
            <div className="mt-3 space-y-3">
          <TextWithChoices label="Item name" value={itemName} options={names} onChange={(v) => set("itemName", v)} />
          <div className="grid grid-cols-2 gap-3">
            <TextWithChoices label="Brand" value={brand} options={brands} onChange={(v) => set("brand", v)} />
            <TextWithChoices label="Size" value={size} options={sizes} onChange={(v) => set("size", v)} />
          </div>
          <label className="block text-xs font-semibold text-zinc-600">
            Category
            <select className={`${inputCls} mt-1`} value={category} onChange={(e) => set("category", e.target.value)}>
              <option value="medicine">medicine</option>
              <option value="non-medicine">non-medicine</option>
              <option value="supermarket">supermarket</option>
            </select>
          </label>

          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-zinc-600">Barcode</legend>
            <div className="flex flex-col gap-1">
              {barcodes.map((b) => (
                <label key={b} className="flex items-center gap-1.5 font-mono text-xs">
                  <input type="radio" name={`bc-${group.groupId}`} checked={barcode === b} onChange={() => set("barcode", b)} />
                  {b}
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" name={`bc-${group.groupId}`} checked={barcode === ""} onChange={() => set("barcode", "")} />
                none (the system will keep the best existing barcode if any)
              </label>
            </div>
          </fieldset>
            </div>
          </details>
        </div>

        <div className="space-y-3">
          {priceConflict && (
            <fieldset className="rounded-lg border border-red-200 bg-red-50 p-2">
              <legend className="px-1 text-xs font-semibold text-red-700">Which price?</legend>
              <div className="flex flex-col gap-1">
                {pairs.map((p) => {
                  const [r, w] = p.split("/");
                  return (
                    <label key={p} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name={`price-${group.groupId}`}
                        checked={retailStr === r && wholesaleStr === w}
                        onChange={() => setOv((o) => ({ ...o, retail: r, wholesale: w }))}
                      />
                      {naira(r)} retail / {naira(w)} wholesale
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {!group.hasPrice && hints.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-zinc-600">Price hints (click to fill)</div>
              <div className="flex flex-wrap gap-1.5">
                {hints.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      setOv((o) => ({
                        ...o,
                        retail: String(h.retailPrice),
                        wholesale: String(h.wholesalePrice),
                        ...(h.distributorPrice > 0 ? { distributor: String(h.distributorPrice) } : {}),
                      }))
                    }
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    {h.name} {naira(h.retailPrice)} / {naira(h.wholesalePrice)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Retail (₦)" value={retailStr} onChange={(v) => set("retail", v)} />
            <NumField label="Wholesale (₦)" value={wholesaleStr} onChange={(v) => set("wholesale", v)} />
            <NumField label="Distributor (₦)" value={distributorStr} onChange={(v) => set("distributor", v)} />
          </div>
          <label className="block text-xs font-semibold text-zinc-600">
            Expiry (defaults to the farthest)
            <input type="date" className={`${inputCls} mt-1`} value={expiry} onChange={(e) => set("expiry", e.target.value)} />
          </label>

          <div>
            <div className="mb-1 text-xs font-semibold text-zinc-600">Stock</div>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-sm">
              <button
                type="button"
                onClick={() => setStockMode("add")}
                className={`px-3 py-1.5 font-semibold ${stockMode === "add" ? "bg-blue-600 text-white" : "bg-white text-zinc-700"}`}
              >
                Add counts together (default)
              </button>
              <button
                type="button"
                onClick={() => setStockMode("keep_one")}
                className={`px-3 py-1.5 font-semibold ${stockMode === "keep_one" ? "bg-blue-600 text-white" : "bg-white text-zinc-700"}`}
              >
                Keep one count
              </button>
            </div>
            {identicalCounts && (
              <div className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                These counts are identical — this may be one count published twice. Choose Keep one if so.
              </div>
            )}
            {stockMode === "keep_one" && (
              <div className="mt-2 space-y-1">
                <label className="block text-xs font-semibold text-zinc-600">
                  Which copy&apos;s count is the real one?
                  <select
                    className={`${inputCls} mt-1`}
                    value={keepFromId}
                    onChange={(e) => setKeepFromOverride(e.target.value)}
                  >
                    {included.map((m) => (
                      <option key={m._id} value={m._id}>
                        Copy {members.indexOf(m) + 1}: {m.quantityInStock} in stock, {m.unitsSoldEver} sold
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-zinc-500">
                  Stock will be set to that single count minus what was already sold.
                </p>
              </div>
            )}
            <div className="mt-2 text-lg font-bold text-zinc-900">{resultStock.toLocaleString()} in stock</div>
          </div>
        </div>
      </div>

      {(problems.length > 0 || error) && (
        <div className="mt-3 space-y-1 text-xs">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700">{error}</div>}
          {problems.map((p) => (
            <div key={p} className="text-amber-700">
              • {p}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {onSkip && (
          <button
            onClick={onSkip}
            disabled={!!busy}
            className="mr-auto rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Skip for now →
          </button>
        )}
        <button
          onClick={doNotSame}
          disabled={!!busy}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {busy === "not_same" ? "Saving…" : "Not the same"}
        </button>
        <button
          onClick={doMerge}
          disabled={!canMerge}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "merge" ? "Merging…" : `Merge ${n} copies`}
        </button>
      </div>
    </div>
  );
}

interface MergeFields {
  itemName: string;
  brand: string;
  size: string;
  category: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  barcode: string;
  expiryDate: string | null;
}

function TextWithChoices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-600">{label}</span>
        {options.length > 1 && (
          <select
            className="max-w-[60%] rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
            value=""
            onChange={(e) => e.target.value && onChange(e.target.value)}
          >
            <option value="">Pick a spelling…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </div>
      <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
}) {
  return (
    <label className="block text-xs font-semibold text-zinc-600">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        className={`${inputCls} mt-1`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Price row (tab 3)
// ---------------------------------------------------------------------------

function PriceRow({
  item,
  branchId,
  onZoom,
  onSaved,
}: {
  item: PriceItem;
  branchId: string;
  onZoom: (src: string) => void;
  onSaved: (item: PriceItem) => void;
}) {
  const [retail, setRetail] = useState(Number(item.retailPrice) > 0 ? String(item.retailPrice) : "");
  const [wholesale, setWholesale] = useState(Number(item.wholesalePrice) > 0 ? String(item.wholesalePrice) : "");
  const [distributor, setDistributor] = useState(Number(item.distributorPrice) > 0 ? String(item.distributorPrice) : "");
  const [brand, setBrand] = useState(/^unknown/i.test(item.brand ?? "") ? "" : item.brand ?? "");
  const [size, setSize] = useState(item.size ?? "");
  const [name, setName] = useState(item.itemName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsBrand = item.reasons.includes("unknown_brand");
  const needsSize = item.reasons.includes("no_size");

  const r = numOrNull(retail);
  const w = numOrNull(wholesale);
  const d = numOrNull(distributor);
  let problem: string | null = null;
  if (r === null || !(r > 0)) problem = "Retail must be above 0";
  else if (w === null || !(w > 0)) problem = "Wholesale must be above 0";
  else if (w > r) problem = "Wholesale cannot exceed retail";
  else if (d !== null && d < 0) problem = "Distributor cannot be negative";
  else if (needsBrand && !brand.trim()) problem = "Enter the brand";
  else if (needsSize && !size.trim()) problem = "Enter the size";
  else if (!name.trim()) problem = "Name is required";

  async function save() {
    if (problem || busy || r === null || w === null) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/triage-v2/price", {
        branchId,
        productId: item._id,
        retailPrice: r,
        wholesalePrice: w,
        distributorPrice: d ?? 0,
        brand: brand.trim(),
        size: size.trim(),
        itemName: name.trim(),
      });
      onSaved(item);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <PhotoPair member={item} onZoom={onZoom} />
        <div className="min-w-[220px] flex-1 space-y-1">
          <div className="text-sm font-bold text-zinc-900">{item.itemName}</div>
          <div className="text-xs text-zinc-600">
            {item.brand || "—"} · {item.size || "—"} · Stock <b>{item.quantityInStock}</b>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.reasons.map((reason) => {
              const info = REASON_LABELS[reason] ?? { label: reason, cls: "bg-zinc-100 text-zinc-600 border-zinc-200" };
              return (
                <Chip key={reason} cls={info.cls}>
                  {info.label}
                </Chip>
              );
            })}
          </div>
          {item.hints.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {item.hints.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setRetail(String(h.retailPrice));
                    setWholesale(String(h.wholesalePrice));
                    if (h.distributorPrice > 0) setDistributor(String(h.distributorPrice));
                  }}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  {h.name} {naira(h.retailPrice)} / {naira(h.wholesalePrice)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-full space-y-2 lg:w-[420px]">
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Retail (₦)" value={retail} onChange={setRetail} onEnter={save} />
            <NumField label="Wholesale (₦)" value={wholesale} onChange={setWholesale} onEnter={save} />
            <NumField label="Distributor (₦)" value={distributor} onChange={setDistributor} onEnter={save} />
          </div>
          {(needsBrand || needsSize) && (
            <div className="grid grid-cols-2 gap-2">
              {needsBrand && (
                <label className="block text-xs font-semibold text-zinc-600">
                  Brand
                  <input className={`${inputCls} mt-1`} value={brand} onChange={(e) => setBrand(e.target.value)} />
                </label>
              )}
              {needsSize && (
                <label className="block text-xs font-semibold text-zinc-600">
                  Size
                  <input className={`${inputCls} mt-1`} value={size} onChange={(e) => setSize(e.target.value)} />
                </label>
              )}
            </div>
          )}
          {(needsBrand || needsSize) && (
            <label className="block text-xs font-semibold text-zinc-600">
              Name
              <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{error}</div>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-amber-700">{problem ?? ""}</span>
            <button
              onClick={save}
              disabled={!!problem || busy}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

interface QueueResponse {
  tabCounts: Counts;
  items: (GroupItem | PriceItem)[];
  nextCursor: string | null;
}

export default function MonakTriageV2Client({ branchId }: { branchId: string }) {
  const [tab, setTab] = useState<TabKey>("dup_priced");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [tabs, setTabs] = useState<Record<TabKey, TabState>>({
    dup_priced: EMPTY_TAB,
    dup_unpriced: EMPTY_TAB,
    price: EMPTY_TAB,
  });
  const [zoom, setZoom] = useState<string | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const inflight = useRef<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState(true);
  const [idx, setIdx] = useState(0);
  const qRef = useRef("");
  const firstQ = useRef(true);

  const patchTab = useCallback((key: TabKey, patch: Partial<TabState>) => {
    setTabs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const url = useCallback(
    (key: TabKey, limit: number, cursor?: string | null) =>
      `/api/triage-v2/queue?tab=${key}&branchId=${encodeURIComponent(branchId)}&limit=${limit}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }${qRef.current ? `&q=${encodeURIComponent(qRef.current)}` : ""}`,
    [branchId]
  );

  const loadTab = useCallback(
    async (key: TabKey, cursor?: string | null) => {
      const guard = `${key}:${cursor ?? ""}:${qRef.current}`;
      if (inflight.current[guard]) return;
      inflight.current[guard] = true;
      try {
        const data = await api<QueueResponse>(url(key, 50, cursor));
        setCounts(data.tabCounts);
        setTabs((prev) => ({
          ...prev,
          [key]: {
            items: cursor ? [...prev[key].items, ...data.items] : data.items,
            nextCursor: data.nextCursor,
            loaded: true,
            error: null,
            loadingMore: false,
          },
        }));
      } catch (e) {
        setTabs((prev) => ({ ...prev, [key]: { ...prev[key], loaded: true, error: errText(e), loadingMore: false } }));
      } finally {
        inflight.current[guard] = false;
      }
    },
    [url]
  );

  // Quiet refresh of the counts only (cheap: 1 row).
  const refreshCounts = useCallback(async () => {
    try {
      const data = await api<QueueResponse>(url("price", 1));
      setCounts(data.tabCounts);
    } catch {
      /* keep local counts */
    }
  }, [url]);

  // Initial: restore last tab and load it.
  useEffect(() => {
    let initial: TabKey = "dup_priced";
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === "dup_priced" || s === "dup_unpriced" || s === "price") initial = s;
    } catch {
      /* ignore */
    }
    setTab(initial);
    void loadTab(initial);
  }, [loadTab]);

  // Search: debounce typing, then reload every tab with the new filter.
  useEffect(() => {
    if (firstQ.current) {
      firstQ.current = false;
      return;
    }
    const t = setTimeout(() => {
      qRef.current = search.trim();
      inflight.current = {};
      setTabs({ dup_priced: EMPTY_TAB, dup_unpriced: EMPTY_TAB, price: EMPTY_TAB });
      setIdx(0);
      void loadTab(tab);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function selectTab(key: TabKey) {
    setTab(key);
    setIdx(0);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* ignore */
    }
    if (!tabs[key].loaded) void loadTab(key);
  }

  function loadMore() {
    const cur = tabs[tab];
    if (!cur.nextCursor || cur.loadingMore) return;
    patchTab(tab, { loadingMore: true });
    void loadTab(tab, cur.nextCursor);
  }

  function removeItem(key: TabKey, matches: (i: GroupItem | PriceItem) => boolean) {
    setTabs((prev) => ({ ...prev, [key]: { ...prev[key], items: prev[key].items.filter((i) => !matches(i)) } }));
    setCounts((c) => (c ? { ...c, [key]: Math.max(0, c[key] - 1) } : c));
    void refreshCounts();
  }

  function handleGroupRemoved(g: GroupItem) {
    removeItem(tab, (i) => (i as GroupItem).groupId === g.groupId);
  }

  function handleMerged(res: MergeResponse, g: GroupItem, keptId: string, fields: MergeFields) {
    if (res.groupStatus === "resolved") {
      handleGroupRemoved(g);
      return;
    }
    // Group stays open with the copies that were left unchecked (+ the surviving product).
    const removed = new Set(res.removedProductIds);
    const members = g.members
      .filter((m) => !removed.has(m._id))
      .map((m) =>
        m._id === keptId
          ? {
              ...m,
              itemName: fields.itemName,
              brand: fields.brand,
              size: fields.size,
              category: fields.category,
              retailPrice: fields.retailPrice,
              wholesalePrice: fields.wholesalePrice,
              distributorPrice: fields.distributorPrice,
              barcode: fields.barcode,
              expiryDate: fields.expiryDate,
              quantityInStock: res.quantityInStock,
            }
          : m
      );
    const hasPrice = members.some((m) => Number(m.retailPrice) > 0);
    setTabs((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        items: prev[tab].items.map((i) =>
          (i as GroupItem).groupId === g.groupId ? ({ ...(i as GroupItem), members, hasPrice } as GroupItem) : i
        ),
      },
    }));
    void refreshCounts();
  }

  const cur = tabs[tab];
  const safeIdx = Math.min(idx, Math.max(0, cur.items.length - 1));
  // Keep the next page coming while the operator works through the queue.
  useEffect(() => {
    if (focus && cur.nextCursor && !cur.loadingMore && cur.items.length - safeIdx <= 5) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, safeIdx, cur.items.length, cur.nextCursor]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-zinc-900">Monak Triage</h1>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, brand or size…"
          className="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
        {search.trim() && (
          <span className="text-xs text-zinc-500">Filtering all tabs — tab numbers still show the full totals</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabBar tab={tab} counts={counts} onSelect={selectTab} />
        <button
          onClick={() => setFocus((f) => !f)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          {focus ? "Show full list" : "One at a time"}
        </button>
      </div>

      {!cur.loaded && <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>}

      {cur.loaded && cur.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {cur.error}
          <button
            onClick={() => {
              patchTab(tab, { loaded: false, error: null });
              void loadTab(tab);
            }}
            className="ml-3 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {cur.loaded && !cur.error && cur.items.length === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center text-sm font-semibold text-zinc-500">
          Nothing left here — all done
        </div>
      )}

      {focus && cur.loaded && cur.items.length > 0 && (
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="flex items-center justify-between text-sm text-zinc-600">
            <button
              onClick={() => setIdx(Math.max(0, safeIdx - 1))}
              disabled={safeIdx === 0}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              ← Back
            </button>
            <span className="font-semibold">
              {safeIdx + 1} of {cur.items.length}
              {cur.nextCursor ? "+" : ""} loaded
            </span>
            <button
              onClick={() => setIdx(Math.min(cur.items.length - 1, safeIdx + 1))}
              disabled={safeIdx >= cur.items.length - 1}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          {tab === "price" ? (
            <PriceRow
              key={(cur.items[safeIdx] as PriceItem)._id}
              item={cur.items[safeIdx] as PriceItem}
              branchId={branchId}
              onZoom={setZoom}
              onSaved={(saved) => removeItem("price", (i) => (i as PriceItem)._id === saved._id)}
            />
          ) : (
            <GroupCard
              key={`${(cur.items[safeIdx] as GroupItem).groupId}:${(cur.items[safeIdx] as GroupItem).members.map((m) => m._id).join("-")}`}
              group={cur.items[safeIdx] as GroupItem}
              branchId={branchId}
              onZoom={setZoom}
              onMerged={handleMerged}
              onRemoved={handleGroupRemoved}
              compact
              onSkip={() => setIdx(Math.min(cur.items.length - 1, safeIdx + 1))}
            />
          )}
        </div>
      )}

      {!focus && cur.loaded && cur.items.length > 0 && (
        <div className="space-y-4">
          {tab === "price"
            ? (cur.items as PriceItem[]).map((it) => (
                <PriceRow
                  key={it._id}
                  item={it}
                  branchId={branchId}
                  onZoom={setZoom}
                  onSaved={(saved) => removeItem("price", (i) => (i as PriceItem)._id === saved._id)}
                />
              ))
            : (cur.items as GroupItem[]).map((g) => (
                <GroupCard
                  key={`${g.groupId}:${g.members.map((m) => m._id).join("-")}`}
                  group={g}
                  branchId={branchId}
                  onZoom={setZoom}
                  onMerged={handleMerged}
                  onRemoved={handleGroupRemoved}
                />
              ))}
          {cur.nextCursor && (
            <div className="text-center">
              <button
                onClick={loadMore}
                disabled={cur.loadingMore}
                className="rounded-lg border border-zinc-300 bg-white px-5 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {cur.loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {zoom && <ZoomOverlay src={zoom} onClose={closeZoom} />}
    </div>
  );
}
