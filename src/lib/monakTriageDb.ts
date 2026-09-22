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

export class MonakTriageDatabase extends Dexie {
  drafts!: Table<LocalDraft, string>;
  catalog!: Table<LocalCatalogProduct, string>;
  priceList!: Table<LocalPriceListItem, string>;
  syncMetadata!: Table<TriageSyncMetadata, string>;

  constructor() {
    super("psx-monak-triage-db");

    this.version(1).stores({
      drafts: "_id, status, createdAt",
      catalog: "_id, itemName",
      priceList: "_id, itemName",
      syncMetadata: "id",
    });
  }
}

export const triageDb = new MonakTriageDatabase();
