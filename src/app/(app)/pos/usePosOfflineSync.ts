import { useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ProductJSON } from "@/lib/types";

export function usePosOfflineSync(branchId: string | null) {
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<string>("Initializing...");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const isBrowser = typeof window !== "undefined";
  const pendingSales = useLiveQuery(
    () => {
      if (!isBrowser) return [];
      return db.pendingSales.filter(sale => sale.synced === 0 || sale.synced === 2 || sale.synced === false as any).toArray();
    },
    [isBrowser]
  ) || [];

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      syncCatalog();
      syncPendingSales();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus("Offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial sync
    if (navigator.onLine) {
      syncCatalog();
      syncPendingSales();
    } else {
      setSyncStatus("Offline (Local Mode)");
      loadLastSyncTime();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [branchId]);

  async function loadLastSyncTime() {
    const meta = await db.syncMetadata.get("products");
    if (meta?.lastSyncedAt) {
      setLastSyncedAt(new Date(Number(meta.lastSyncedAt)));
    }
  }

  async function syncCatalog() {
    try {
      setSyncStatus("Syncing catalog...");

      const meta = await db.syncMetadata.get("products");
      const lastSync = meta?.lastSyncedAt || "";

      // A first-ever sync (or one forced full after a deletion elsewhere) can be the whole
      // catalog — thousands of products in one response. Paging it in chunks avoids one
      // huge request/response and lets the local cache fill in incrementally instead of
      // holding the whole thing in memory before writing anything. A normal delta sync
      // (just recently-changed items) is small enough that this loop just does one page
      // and stops — same cost as before for that case.
      const PAGE_SIZE = 500;
      let skip = 0;
      let clearedForFullSync = false;
      let firstPageTimestamp: number | null = null;
      let totalSynced = 0;

      for (;;) {
        const params = new URLSearchParams();
        if (branchId) params.set("branchId", branchId);
        if (lastSync) params.set("lastSyncedAt", lastSync);
        params.set("limit", String(PAGE_SIZE));
        params.set("skip", String(skip));

        const res = await fetch(`/api/products?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch products");

        const data = await res.json();
        if (firstPageTimestamp === null && data.timestamp) firstPageTimestamp = data.timestamp;

        if (data.fullSyncRequired && !clearedForFullSync) {
          await db.products.clear();
          clearedForFullSync = true;
        }

        const products: ProductJSON[] = data.products || [];
        if (products.length > 0) {
          await db.products.bulkPut(products);
          totalSynced += products.length;
          setSyncStatus(`Syncing catalog... (${totalSynced})`);
        }

        if (products.length < PAGE_SIZE) break; // last page
        skip += PAGE_SIZE;
      }

      if (firstPageTimestamp) {
        await db.syncMetadata.put({
          id: "products",
          lastSyncedAt: firstPageTimestamp.toString(),
        });
        setLastSyncedAt(new Date(firstPageTimestamp));
      }

      setSyncStatus("Fully synced");
    } catch (err) {
      console.error("Catalog sync error:", err);
      setSyncStatus("Sync failed. Operating locally.");
    }
  }

  async function syncPendingSales() {
    try {
      const pending = await db.pendingSales.filter(sale => sale.synced === 0 || sale.synced === false as any).toArray();
      
      if (pending.length === 0) return;

      setSyncStatus(`Syncing ${pending.length} offline sales...`);

      for (const sale of pending) {
        const payload = {
          customerName: sale.customerName,
          items: sale.items,
          payments: sale.payments,
          offlineReceiptNumber: sale.offlineReceiptNumber,
          timestamp: sale.timestamp,
          branchId,
          changeFee: Math.max(0, (sale.amountTendered - sale.totalAmount) - sale.changeGiven)
        };

        const res = await fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          await db.pendingSales.update(sale.id!, { synced: 1 });
        } else {
          const errText = await res.text();
          console.error("Sale sync rejected by server:", errText);
          // If it's a 4xx error (bad request, insufficient stock), mark it as failed (2) so it stops retrying
          if (res.status >= 400 && res.status < 500) {
            await db.pendingSales.update(sale.id!, { synced: 2 });
          }
        }
      }

      // Cleanup fully synced ones
      const syncedSales = await db.pendingSales.filter(sale => sale.synced === 1 || sale.synced === true as any).toArray();
      const syncedIds = syncedSales.map(s => s.id!).filter(Boolean);
      if (syncedIds.length > 0) {
        await db.pendingSales.bulkDelete(syncedIds);
      }
      setSyncStatus("Fully synced");

    } catch (err) {
      console.error("Pending sales sync error:", err);
      setSyncStatus("Sales sync failed.");
    }
  }

  return { isOnline, syncStatus, lastSyncedAt, syncCatalog, syncPendingSales, pendingSales };
}
