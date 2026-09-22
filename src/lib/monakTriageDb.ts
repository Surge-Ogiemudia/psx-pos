import Dexie, { Table } from "dexie";

// Offline cache for Monak Triage Mobile (stage 1 — read-only offline: browse/review/edit the
// queue, run duplicate-check and price-match locally. Writes — Confirm/Skip/Merge — still
// require a live connection; nothing here queues them). Separate Dexie database from POS's
// `psx-pos-db` (src/lib/db.ts) on purpose: this caches a *branch-scoped slice* of data shaped
// for triage's own screens, not the full product catalog POS needs for checkout, and keeping
// them apart avoids coupling two independently-evolving offline caches through one shared
// version/upgrade path.

// Mirrors the `AiDraft` shape MonakTriageMobileClient.tsx renders — the current batch of
// queue drafts (already filtered to "active", same as the component's own `rawQueue`).
export interface LocalDraft {
  _id: string;
  frontImageUrl: string;
  backImageUrl: string | null;
  quantityInStock: number;
  retailPrice: number | null;
  category: "medicine" | "non-medicine" | "supermarket";
  createdAt: string;
  status: "pending" | "processing" | "extracted" | "completed" | "error" | "dismissed" | "confirming" | "skipped";
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  extractedExpiryDate?: string | null;
  productId?: string | null;
}

// A trimmed, branch-scoped slice of the live product catalog — just what the client-side
// duplicate-check (isDuplicateText, from src/lib/duplicateDetection.ts) needs. Deliberately NOT
// the full Product document (no costPrice/batchNumber/unitHierarchy/etc) — mirrors the same
// field selection /api/products/[id]/possible-duplicates already uses server-side.
export interface LocalCatalogProduct {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  quantityInStock: number;
}

// The monak-excel2 price reference list — itemName + the three price tiers, nothing else.
// Reference data that changes rarely, so this is cached whole rather than paged by query.
export interface LocalPriceListItem {
  _id: string;
  itemName: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

export interface TriageSyncMetadata {
  id: "drafts" | "catalog" | "priceList"; // one row per cached table
  lastSyncedAt: string; // epoch ms, as a string — same convention as db.ts's SyncMetadata
}

// Stage 2 of the offline plan: a write queue for Confirm & Save / Skip, taken while offline
// and replayed against the real API once connectivity returns. Merge is deliberately NOT
// covered — it mutates shared live inventory concurrently touched by real POS sales and other
// operators, and needs its own conflict-detection pass (a later stage) before it's safe to
// queue; it keeps requiring a live connection.
//
// "pending"  — queued, not yet attempted (or a network-level attempt failed and it's waiting
//              to be retried; that's not a server rejection, just "haven't gotten through yet").
// "syncing"  — a replay attempt is in flight right now.
// "synced"   — the server accepted it; this is a transient state, the row is deleted right
//              after (mirrors usePosOfflineSync's pendingSales synced=1 cleanup).
// "failed"   — the server actually rejected the replayed request (e.g. the draft was already
//              claimed/completed by someone else, or a validation error) — terminal, surfaced
//              to the operator, never auto-retried (same as pendingSales' synced=2).
export type PendingActionType = "confirm" | "skip";
export type PendingActionStatus = "pending" | "syncing" | "synced" | "failed";

// The exact body each action sends today — see handleSaveAndNext/handleSkip in
// MonakTriageMobileClient.tsx. Typed loosely (rather than duplicating ProductForm's shape
// here) since this table's only job is to replay what was already validated client-side at
// the time the operator tapped Confirm/Skip, not to re-validate it.
export interface PendingTriageAction {
  id?: number; // auto-increment, same convention as db.ts's PendingSale
  actionType: PendingActionType;
  draftId: string;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  createdAt: number; // epoch ms — orders replay as a FIFO queue
  errorMessage?: string;
}

export class MonakTriageDatabase extends Dexie {
  drafts!: Table<LocalDraft, string>;
  catalog!: Table<LocalCatalogProduct, string>;
  priceList!: Table<LocalPriceListItem, string>;
  syncMetadata!: Table<TriageSyncMetadata, string>;
  pendingActions!: Table<PendingTriageAction, number>;

  constructor() {
    super("psx-monak-triage-db");

    this.version(1).stores({
      drafts: "_id, status, createdAt",
      catalog: "_id, itemName",
      priceList: "_id, itemName",
      syncMetadata: "id",
    });

    this.version(2).stores({
      drafts: "_id, status, createdAt",
      catalog: "_id, itemName",
      priceList: "_id, itemName",
      syncMetadata: "id",
      pendingActions: "++id, draftId, status, createdAt",
    });
  }
}

export const triageDb = new MonakTriageDatabase();
