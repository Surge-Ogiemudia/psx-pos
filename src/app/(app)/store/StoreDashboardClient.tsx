"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProductCategory, StoreProductJSON } from "@/lib/types";
import { describeStock } from "@/lib/unitHierarchy";
import { getExpiryStatus, EXPIRY_ROW_CLASS, EXPIRY_TEXT_CLASS } from "@/lib/expiry";
import IncomingBanner from "@/components/IncomingBanner";
import AlertFilterButton from "@/components/AlertFilterButton";

export default function StoreDashboardClient({
  fixedStoreId,
  activeStoreId,
  canDelete,
}: {
  fixedStoreId: string | null;
  activeStoreId: string | null;
  canDelete: boolean;
}) {
  const storeId = fixedStoreId ?? activeStoreId ?? "";
  const [products, setProducts] = useState<StoreProductJSON[]>([]);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | "all">("all");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "expired" | "urgent" | "warning" | "not_expired">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "stockout" | "lastUnit" | "low" | "not_stockout">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [alertsHidden, setAlertsHidden] = useState(false);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllCount, setDeleteAllCount] = useState<number | null>(null);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [deleteAllSubmitting, setDeleteAllSubmitting] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);

  function loadProducts() {
    if (!storeId) return;
    const params = new URLSearchParams({ storeId });
    if (search) params.set("search", search);
    fetch(`/api/store-products?${params}`)
      .then((res) => res.json())
      .then((data) => setProducts(data.storeProducts || []));
  }

  useEffect(loadProducts, [storeId]);

  useEffect(() => {
    const timeout = setTimeout(loadProducts, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function openDeleteAllConfirm() {
    setDeleteAllError(null);
    setDeleteAllConfirmText("");
    setDeleteAllCount(null);
    setDeleteAllOpen(true);
    const res = await fetch(`/api/store-products?storeId=${storeId}`);
    if (res.ok) {
      setDeleteAllCount((await res.json()).storeProducts.length);
    } else {
      setDeleteAllError("Couldn't load the current item count — try again.");
    }
  }

  async function confirmDeleteAll() {
    if (deleteAllCount === null || deleteAllConfirmText !== "DELETE") return;
    setDeleteAllSubmitting(true);
    setDeleteAllError(null);
    try {
      const params = new URLSearchParams({ storeId, expectedCount: String(deleteAllCount) });
      const res = await fetch(`/api/store-products?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteAllError(data.error || "Failed to delete this store's items");
        setDeleteAllCount(typeof data.actualCount === "number" ? data.actualCount : deleteAllCount);
        setDeleteAllConfirmText("");
        return;
      }
      setDeleteAllOpen(false);
      loadProducts();
    } finally {
      setDeleteAllSubmitting(false);
    }
  }

  const visibleProducts = products.filter((p) => {
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (expiryFilter !== "all") {
      const level = getExpiryStatus(p.soonestExpiryDate).level;
      if (expiryFilter === "not_expired" ? level === "expired" : level !== expiryFilter) return false;
    }
    if (stockFilter !== "all") {
      if (stockFilter === "not_stockout" && p.quantityInStock <= 0) return false;
      if (stockFilter === "stockout" && p.quantityInStock > 0) return false;
      if (stockFilter === "lastUnit" && p.quantityInStock !== 1) return false;
      if (stockFilter === "low" && !(p.quantityInStock > 1 && p.lowStockThreshold > 0 && p.quantityInStock <= p.lowStockThreshold)) {
        return false;
      }
    }
    return true;
  });

  const activeFilterCount =
    (categoryFilter !== "all" ? 1 : 0) + (expiryFilter !== "all" ? 1 : 0) + (stockFilter !== "all" ? 1 : 0);

  const expiredProducts = products.filter((p) => getExpiryStatus(p.soonestExpiryDate).level === "expired");
  const urgentProducts = products.filter((p) => getExpiryStatus(p.soonestExpiryDate).level === "urgent");
  const warningProducts = products.filter((p) => getExpiryStatus(p.soonestExpiryDate).level === "warning");
  const stockoutProducts = products.filter((p) => p.quantityInStock <= 0);
  const lastUnitProducts = products.filter((p) => p.quantityInStock === 1);
  const lowStockProducts = products.filter(
    (p) => p.quantityInStock > 1 && p.lowStockThreshold > 0 && p.quantityInStock <= p.lowStockThreshold
  );
  const totalAlertCount =
    expiredProducts.length +
    urgentProducts.length +
    warningProducts.length +
    stockoutProducts.length +
    lastUnitProducts.length +
    lowStockProducts.length;

  if (!storeId) {
    return (
      <div>
        <h1 className="mb-3 text-lg font-semibold text-zinc-900">Bulk store</h1>
        <p className="text-sm text-zinc-500">
          No stores have been set up yet. An admin can create one from the Stores page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Bulk store</h1>
        <IncomingBanner scope="store" scopeId={storeId} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={`/store/intake?storeId=${storeId}`}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Receive stock
        </Link>
        <Link
          href={`/store/intake/bulk?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Bulk receive
        </Link>
        <Link
          href="/inventorycreator"
          className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-1.5 text-sm font-bold text-teal-800 hover:bg-teal-100 flex items-center gap-1.5 shadow-sm"
        >
          <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          AI Scanner
        </Link>
        <Link
          href={`/store/push-sell?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Push / Sell
        </Link>
        <Link
          href={`/store/push-sell/bulk?storeId=${storeId}`}
          className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          Bulk push
        </Link>
        <Link
          href={`/store/history?storeId=${storeId}`}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          History
        </Link>
        <Link
          href="/store/buyers"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Buyers
        </Link>
        <Link
          href="/store/suppliers"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Suppliers
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
        <div className="relative shrink-0">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-6.757a2.25 2.25 0 00-.659-1.591L2.659 5.22A2.25 2.25 0 012 3.629V1.34a.75.75 0 01.628-.74z"
                clipRule="evenodd"
              />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-1 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filtersOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
              <div className="flex flex-col gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as ProductCategory | "all")}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">All categories</option>
                  <option value="medicine">Medicine</option>
                  <option value="non-medicine">Non-medicine</option>
                  <option value="supermarket">Supermarket</option>
                </select>
                <select
                  value={expiryFilter}
                  onChange={(e) => setExpiryFilter(e.target.value as typeof expiryFilter)}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">Any expiry</option>
                  <option value="expired">Expired</option>
                  <option value="urgent">Expiring within 30 days</option>
                  <option value="warning">Expiring within 90 days</option>
                  <option value="not_expired">Not expired</option>
                </select>
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">Any stock level</option>
                  <option value="stockout">Stockout</option>
                  <option value="lastUnit">Only 1 left</option>
                  <option value="low">Below reorder point</option>
                  <option value="not_stockout">Not stockout</option>
                </select>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setCategoryFilter("all");
                      setExpiryFilter("all");
                      setStockFilter("all");
                    }}
                    className="text-left text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {totalAlertCount > 0 && (
        <div className="mb-1 flex justify-end">
          <button
            onClick={() => setAlertsHidden((v) => !v)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 hover:underline"
          >
            {alertsHidden ? `Show alerts (${totalAlertCount})` : "Hide alerts"}
          </button>
        </div>
      )}

      {!alertsHidden && expiredProducts.length + urgentProducts.length + warningProducts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center">
          <span className="text-xs font-medium text-zinc-500">Expiry:</span>
          <div className="flex flex-wrap gap-2">
            {expiredProducts.length > 0 && (
              <AlertFilterButton
                count={expiredProducts.length}
                label="expired"
                severity="high"
                active={expiryFilter === "expired"}
                onClick={() => setExpiryFilter((prev) => (prev === "expired" ? "all" : "expired"))}
              />
            )}
            {urgentProducts.length > 0 && (
              <AlertFilterButton
                count={urgentProducts.length}
                label="expiring within 30 days"
                severity="medium"
                active={expiryFilter === "urgent"}
                onClick={() => setExpiryFilter((prev) => (prev === "urgent" ? "all" : "urgent"))}
              />
            )}
            {warningProducts.length > 0 && (
              <AlertFilterButton
                count={warningProducts.length}
                label="expiring within 90 days"
                severity="low"
                active={expiryFilter === "warning"}
                onClick={() => setExpiryFilter((prev) => (prev === "warning" ? "all" : "warning"))}
              />
            )}
            {expiryFilter !== "all" && (
              <button
                onClick={() => setExpiryFilter("all")}
                className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {!alertsHidden && stockoutProducts.length + lastUnitProducts.length + lowStockProducts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center">
          <span className="text-xs font-medium text-zinc-500">Stock:</span>
          <div className="flex flex-wrap gap-2">
            {stockoutProducts.length > 0 && (
              <AlertFilterButton
                count={stockoutProducts.length}
                label="stockout"
                severity="high"
                active={stockFilter === "stockout"}
                onClick={() => setStockFilter((prev) => (prev === "stockout" ? "all" : "stockout"))}
              />
            )}
            {lastUnitProducts.length > 0 && (
              <AlertFilterButton
                count={lastUnitProducts.length}
                label={`item${lastUnitProducts.length === 1 ? "" : "s"} with only 1 left`}
                severity="medium"
                active={stockFilter === "lastUnit"}
                onClick={() => setStockFilter((prev) => (prev === "lastUnit" ? "all" : "lastUnit"))}
              />
            )}
            {lowStockProducts.length > 0 && (
              <AlertFilterButton
                count={lowStockProducts.length}
                label="below reorder point"
                severity="low"
                active={stockFilter === "low"}
                onClick={() => setStockFilter((prev) => (prev === "low" ? "all" : "low"))}
              />
            )}
            {stockFilter !== "all" && (
              <button
                onClick={() => setStockFilter("all")}
                className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Item name</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => {
              const expiryStatus = getExpiryStatus(product.soonestExpiryDate);
              return (
                <tr
                  key={product._id}
                  className={`border-b border-zinc-100 last:border-0 ${EXPIRY_ROW_CLASS[expiryStatus.level]}`}
                >
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    <Link
                      href={`/store/products/${product._id}/batches?storeId=${storeId}`}
                      className="text-teal-700 hover:underline"
                    >
                      {product.itemName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{product.brand}</td>
                  <td className="px-3 py-2 text-zinc-600">{product.size}</td>
                  <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {describeStock(product.quantityInStock, product.displayUnitHierarchy, product.baseUnitName)}
                  </td>
                  <td className={`px-3 py-2 ${EXPIRY_TEXT_CLASS[expiryStatus.level]}`}>
                    {product.soonestExpiryDate ? product.soonestExpiryDate.slice(0, 10) : "—"}
                    {expiryStatus.label && <div className="text-xs">{expiryStatus.label}</div>}
                  </td>
                </tr>
              );
            })}
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {products.length === 0 ? "No stock received yet." : "No items match the current search/filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canDelete && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-red-900">Danger zone</h2>
          <p className="mb-3 text-sm text-red-800">
            Permanently delete every item in this store — all batches, stock, and price settings go with it.
            This cannot be undone.
          </p>
          {!deleteAllOpen ? (
            <button
              onClick={openDeleteAllConfirm}
              className="rounded-lg border border-red-600 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Delete all items in this store
            </button>
          ) : (
            <div className="rounded border border-red-300 bg-white p-3">
              {deleteAllCount === null ? (
                <p className="text-sm text-zinc-600">Checking the current item count...</p>
              ) : (
                <>
                  <p className="mb-2 text-sm text-zinc-800">
                    This will permanently delete <strong>{deleteAllCount}</strong> item
                    {deleteAllCount === 1 ? "" : "s"} from this store, along with their batches and price
                    settings. Type <strong>DELETE</strong> to confirm.
                  </p>
                  <input
                    type="text"
                    value={deleteAllConfirmText}
                    onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="mb-2 w-full max-w-xs rounded border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                  />
                </>
              )}
              {deleteAllError && <p className="mb-2 text-sm text-red-600">{deleteAllError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={confirmDeleteAll}
                  disabled={deleteAllCount === null || deleteAllConfirmText !== "DELETE" || deleteAllSubmitting}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {deleteAllSubmitting
                    ? "Deleting..."
                    : deleteAllCount === null
                    ? "Loading..."
                    : `Permanently delete ${deleteAllCount} item${deleteAllCount === 1 ? "" : "s"}`}
                </button>
                <button
                  onClick={() => setDeleteAllOpen(false)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
