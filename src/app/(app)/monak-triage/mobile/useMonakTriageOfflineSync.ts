import { useState, useEffect, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { triageDb, LocalDraft, LocalCatalogProduct, LocalPriceListItem, PendingTriageAction } from "@/lib/monakTriageDb";

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
//
// Stage 2 adds a write queue: Confirm & Save / Skip, taken while offline, are recorded in
// triageDb.pendingActions (src/lib/monakTriageDb.ts) by the component itself — mirroring how
// PosClient.tsx writes straight to db.pendingSales rather than going through its hook — and
// drained here by syncPendingActions, the same "on mount if online, on reconnect" shape as
// resyncReferenceData above, plus a periodic retry while online in case an earlier attempt
// only got partway through (e.g. the connection dropped mid-replay). Merge is NOT part of this
// queue — see monakTriageDb.ts's PendingTriageAction comment for why.

const STALE_MS = 10 * 60 * 1000; // 10 minutes
const PAGE_SIZE = 500;
const ACTION_RETRY_INTERVAL_MS = 15 * 1000; // periodic retry while online, for stalled syncs

// Replays one queued action against the real API, using the exact payload captured when the
// operator originally tapped Confirm/Skip — same two endpoints handleSaveAndNext/handleSkip
// call today in MonakTriageMobileClient.tsx.
async function replayPendingAction(action: PendingTriageAction): Promise<Response> {
  if (action.actionType === "confirm") {
    return fetch(`/api/products/ai-drafts/${action.draftId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.payload),
    });
  }
  return fetch(`/api/products/ai-drafts/${action.draftId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action.payload),
  });
}

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
  // Every row still sitting in the write queue (pending/syncing/failed — synced ones are
  // deleted right after they land), newest-last so the UI can show them in the order they'll
  // replay. Reactive via useLiveQuery, same pattern usePosOfflineSync.ts uses for pendingSales.
  pendingActions: PendingTriageAction[];
  syncPendingActions: () => Promise<void>;
}

export function useMonakTriageOfflineSync(branchId: string): OfflineSyncState {
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState("Initializing…");
  const [hasCachedReferenceData, setHasCachedReferenceData] = useState(false);
  const [catalog, setCatalog] = useState<LocalCatalogProduct[]>([]);
  const [priceList, setPriceList] = useState<LocalPriceListItem[]>([]);
  const syncingRef = useRef(false);
  const syncingActionsRef = useRef(false);

  const isBrowser = typeof window !== "undefined";
  const pendingActions =
    useLiveQuery(() => {
      if (!isBrowser) return [];
      return triageDb.pendingActions.orderBy("createdAt").toArray();
    }, [isBrowser]) || [];

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

  // Drains the write queue in FIFO order (createdAt), replaying each "pending" action against
  // the real API. Mirrors usePosOfflineSync's syncPendingSales: a plain sequential for-loop
  // (order matters — an operator working several items offline expects them to land in the
  // order they made the decisions), same ok/not-ok branching, same "4xx-shaped rejection stops
  // retrying" idea.
  //
  // "failed" is reserved for an actual server rejection (the fetch resolved, and the response
  // wasn't ok) — e.g. the draft was already claimed/completed by someone else, or a validation
  // error. That's a normal, clear error from the existing API, not a data-corruption risk (see
  // monakTriageDb.ts), so it's fine to just surface it and stop retrying that one. A network-
  // level failure (the fetch itself throws — still offline, or a flaky connection lying about
  // navigator.onLine) is NOT a rejection: it's put back to "pending" and the whole pass stops,
  // so the next reconnect/periodic retry picks up where it left off, same as POS.
  const syncPendingActions = useCallback(async () => {
    if (syncingActionsRef.current || !navigator.onLine) return;
    syncingActionsRef.current = true;
    try {
      // Re-fetches "pending" after every pass instead of working off one snapshot — an
      // operator speeding through cards can queue several more while this is mid-flight
      // (each queue calls this function too, but the guard above makes those calls no-ops).
      // Without re-checking, anything queued during that window would just sit until the
      // 15s periodic retry below instead of going out with this same burst.
      for (;;) {
        const pending = await triageDb.pendingActions.where("status").equals("pending").sortBy("createdAt");
        if (pending.length === 0) break;

        let networkFailure = false;
        for (const action of pending) {
          await triageDb.pendingActions.update(action.id!, { status: "syncing" });
          try {
            const res = await replayPendingAction(action);
            if (res.ok) {
              await triageDb.pendingActions.update(action.id!, { status: "synced", errorMessage: undefined });
            } else {
              const err = await res.json().catch(() => ({ error: `${action.actionType} sync failed` }));
              console.error("Triage action sync rejected by server:", action, err);
              await triageDb.pendingActions.update(action.id!, {
                status: "failed",
                errorMessage: err.error ?? `Server rejected this ${action.actionType} (HTTP ${res.status}).`,
              });
            }
          } catch (err) {
            console.error("Triage action sync network error:", err);
            await triageDb.pendingActions.update(action.id!, { status: "pending" });
            networkFailure = true;
            break; // connection likely dropped mid-pass — stop, let the next retry pick up here
          }
        }
        if (networkFailure) break; // stop the whole drain, not just this inner pass

        // Cleanup fully synced ones from this pass — same as pendingSales, no reason to
        // keep them around once they've landed.
        const syncedIds = (await triageDb.pendingActions.where("status").equals("synced").toArray())
          .map((a) => a.id!)
          .filter(Boolean);
        if (syncedIds.length > 0) await triageDb.pendingActions.bulkDelete(syncedIds);
      }
    } finally {
      syncingActionsRef.current = false;
    }
  }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    // Load whatever's cached immediately so a reload while offline (or before the first
    // network round-trip completes) still has last session's data on screen right away.
    loadReferenceDataFromCache();

    // A row can only be left "syncing" if the app closed/reloaded mid-replay — we don't know
    // whether that request actually landed server-side, but leaving it stuck as "syncing"
    // forever (never retried, never surfaced as failed) would be worse than the small risk of
    // a duplicate replay, so it's reset to "pending" and picked up by the next sync pass.
    triageDb.pendingActions
      .where("status")
      .equals("syncing")
      .modify({ status: "pending" })
      .then(() => {
        if (navigator.onLine) syncPendingActions();
      });

    const handleOnline = () => {
      setIsOnline(true);
      resyncReferenceData();
      syncPendingActions();
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

    // Periodic retry while online — covers a pass that stopped partway through (network
    // error mid-loop above) without waiting for another explicit reconnect event.
    const retryInterval = setInterval(() => {
      if (navigator.onLine) syncPendingActions();
    }, ACTION_RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(retryInterval);
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
    pendingActions,
    syncPendingActions,
  };
}
