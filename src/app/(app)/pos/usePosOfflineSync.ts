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
      return db.pendingSales.where("synced").anyOf(0, 2, false as any).toArray();
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
      
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (lastSync) params.set("lastSyncedAt", lastSync);

      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch products");

      const data = await res.json();
      
      if (data.fullSyncRequired) {
        await db.products.clear();
      }

      const products: ProductJSON[] = data.products || [];
      if (products.length > 0) {
        await db.products.bulkPut(products);
      }

      if (data.timestamp) {
        await db.syncMetadata.put({
          id: "products",
          lastSyncedAt: data.timestamp.toString(),
        });
        setLastSyncedAt(new Date(data.timestamp));
      }

      setSyncStatus("Fully synced");
    } catch (err) {
      console.error("Catalog sync error:", err);
      setSyncStatus("Sync failed. Operating locally.");
    }
  }

  async function syncPendingSales() {
    try {
      const pending0 = await db.pendingSales.where("synced").equals(0).toArray();
      const pendingFalse = await db.pendingSales.where("synced").equals(false as any).toArray();
      const pending = [...pending0, ...pendingFalse];
      
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
      await db.pendingSales.where("synced").equals(1).delete();
      await db.pendingSales.where("synced").equals(true as any).delete();
      setSyncStatus("Fully synced");

    } catch (err) {
      console.error("Pending sales sync error:", err);
      setSyncStatus("Sales sync failed.");
    }
  }

  return { isOnline, syncStatus, lastSyncedAt, syncCatalog, syncPendingSales, pendingSales };
}
