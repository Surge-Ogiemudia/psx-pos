import { useState, useEffect, useCallback, useRef } from "react";
import { triageDb, LocalDraft, LocalCatalogProduct, LocalPriceListItem } from "@/lib/monakTriageDb";

// Offline read cache for Monak Triage Mobile — stage 1 of the offline plan: browsing,
// reviewing, and editing the queue works with zero network calls once synced; Confirm/Skip/
// Merge (actual writes) still require a live connection, same as today. Modeled directly on
// the POS offline pattern (src/app/(app)/pos/usePosOfflineSync.ts) — same isOnline detection
// via the browser's online/offline events, same "sync on mount, resync on reconnect" shape —
// adapted to what Triage actually needs cached (see src/lib/monakTriageDb.ts):
//   - drafts: the current batch of queue drafts (already fetched by the caller's own poll;
//     this hook just persists/reads it, it doesn't own the polling loop itself).
//   - catalog: a trimmed branch-catalog slice, for the client-side duplicate-check.
//   - priceList: the whole monak-excel2 reference list, for the client-side price search.
//
// Reference data (catalog, priceList) changes far less often than the draft queue, so it's
// resynced only on mount, on reconnect, and when explicitly stale (STALE_MS) — not on every
// 5s queue poll the way the drafts themselves are.

const STALE_MS = 10 * 60 * 1000; // 10 minutes
const PAGE_SIZE = 500;

export interface OfflineSyncState {
  isOnline: boolean;
  syncStatus: string;
  // True once IndexedDB has ever held synced catalog/price data (this session or a previous
  // one) — distinguishes "no data yet, still syncing" from "no data yet, and offline" in the UI.
  hasCachedReferenceData: boolean;
  catalog: LocalCatalogProduct[];
  priceList: LocalPriceListItem[];
  saveDraftsSnapshot: (drafts: LocalDraft[]) => Promise<void>;
  loadCachedDrafts: () => Promise<LocalDraft[]>;
  resyncReferenceData: () => Promise<void>;
}

export function useMonakTriageOfflineSync(branchId: string): OfflineSyncState {
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState("Initializing…");
  const [hasCachedReferenceData, setHasCachedReferenceData] = useState(false);
  const [catalog, setCatalog] = useState<LocalCatalogProduct[]>([]);
  const [priceList, setPriceList] = useState<LocalPriceListItem[]>([]);
  const syncingRef = useRef(false);

  // Pull whatever's currently in IndexedDB into the in-memory arrays the component's
  // duplicate-check/price-search actually scan — refreshed after every sync (and once on
  // mount so a fully-offline reload still has last session's cache immediately).
  const loadReferenceDataFromCache = useCallback(async () => {
    const [cachedCatalog, cachedPriceList] = await Promise.all([
      triageDb.catalog.toArray(),
      triageDb.priceList.toArray(),
    ]);
    setCatalog(cachedCatalog);
    setPriceList(cachedPriceList);
    setHasCachedReferenceData(cachedCatalog.length > 0 || cachedPriceList.length > 0);
  }, []);

  const syncCatalog = useCallback(async () => {
    if (!branchId) return;
    let skip = 0;
    let first = true;
    for (;;) {
      const params = new URLSearchParams({ branchId, limit: String(PAGE_SIZE), skip: String(skip) });
      const res = await fetch(`/api/products/catalog-lite?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch catalog");
      const data = await res.json();
      const products: LocalCatalogProduct[] = data.products ?? [];

      if (first) {
        // Full replace each sync (this reference slice has no delete-tracking, unlike POS's
        // product sync) — the catalog is small enough (a few thousand rows) that a clean
        // resync is simpler and correct, at the cost of a bit more bandwidth than a delta
        // sync would use.
        await triageDb.catalog.clear();
        first = false;
      }
      if (products.length > 0) {
        await triageDb.catalog.bulkPut(products);
        setSyncStatus(`Syncing catalog… (${skip + products.length})`);
      }
      if (products.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    await triageDb.syncMetadata.put({ id: "catalog", lastSyncedAt: Date.now().toString() });
  }, [branchId]);

  const syncPriceList = useCallback(async () => {
    let skip = 0;
    let first = true;
    for (;;) {
      const params = new URLSearchParams({ sync: "1", limit: String(PAGE_SIZE), skip: String(skip) });
      const res = await fetch(`/api/monak-excel2?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch price list");
      const data = await res.json();
      const items: LocalPriceListItem[] = data.items ?? [];

      if (first) {
        await triageDb.priceList.clear();
        first = false;
      }
      if (items.length > 0) {
        await triageDb.priceList.bulkPut(items);
        setSyncStatus(`Syncing price list… (${skip + items.length})`);
      }
      if (items.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    await triageDb.syncMetadata.put({ id: "priceList", lastSyncedAt: Date.now().toString() });
  }, []);

  const resyncReferenceData = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    try {
      setSyncStatus("Syncing…");
      await Promise.all([syncCatalog(), syncPriceList()]);
      await loadReferenceDataFromCache();
      setSyncStatus("Synced");
    } catch (err) {
      console.error("Monak Triage offline sync error:", err);
      setSyncStatus("Sync failed — showing last cached data");
      // Even a failed sync should still surface whatever was cached before (partial page
      // progress, or a prior session's data), rather than leaving the UI on stale in-memory
      // state from before this attempt.
      await loadReferenceDataFromCache();
    } finally {
      syncingRef.current = false;
    }
  }, [syncCatalog, syncPriceList, loadReferenceDataFromCache]);

  const saveDraftsSnapshot = useCallback(async (drafts: LocalDraft[]) => {
    // The fetched batch IS the current active queue (server already filters to active
    // statuses, and the caller filters further) — replace wholesale rather than merge, so
    // items that left the batch (confirmed/skipped elsewhere) drop out of the cache too.
    await triageDb.transaction("rw", triageDb.drafts, async () => {
      await triageDb.drafts.clear();
      if (drafts.length > 0) await triageDb.drafts.bulkPut(drafts);
    });
    await triageDb.syncMetadata.put({ id: "drafts", lastSyncedAt: Date.now().toString() });
  }, []);

  const loadCachedDrafts = useCallback(async () => {
    return triageDb.drafts.toArray();
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    // Load whatever's cached immediately so a reload while offline (or before the first
    // network round-trip completes) still has last session's data on screen right away.
    loadReferenceDataFromCache();

    const handleOnline = () => {
      setIsOnline(true);
      resyncReferenceData();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus("Offline — showing cached data");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (navigator.onLine) {
      triageDb.syncMetadata.get("catalog").then((meta) => {
        const staleOrMissing = !meta || Date.now() - Number(meta.lastSyncedAt) > STALE_MS;
        if (staleOrMissing) resyncReferenceData();
        else setSyncStatus("Synced");
      });
    } else {
      setSyncStatus("Offline — showing cached data");
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  return {
    isOnline,
    syncStatus,
    hasCachedReferenceData,
    catalog,
    priceList,
    saveDraftsSnapshot,
    loadCachedDrafts,
    resyncReferenceData,
  };
}
