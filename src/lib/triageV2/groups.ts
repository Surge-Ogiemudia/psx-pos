import mongoose from "mongoose";
import Product from "@/models/Product";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import DuplicateReviewDecision from "@/models/DuplicateReviewDecision";
import TriageDuplicateGroup from "@/models/TriageDuplicateGroup";
import { cleanStr, diceSimilarity } from "@/lib/fuzzyMatch";

export type GroupTier = "exact" | "strict_fuzzy" | "barcode";

export interface GroupFlags {
  brandDiffers: boolean;
  sizeDiffers: boolean;
  priceConflict: boolean;
  barcodeConflict: boolean;
}

export interface ComputedGroup {
  groupKey: string;
  productIds: string[];
  tier: GroupTier;
  hasPrice: boolean;
  flags: GroupFlags;
}

const oid = (s: string) => new mongoose.Types.ObjectId(s);

export function makeGroupKey(ids: string[]): string {
  return ids.slice().sort().join("-");
}

// ---------- normalization helpers ----------

const FORM_WORDS = [
  "tablets", "tablet", "capsules", "capsule", "caplets", "caplet", "syrup", "suspension",
  "cream", "ointment", "gel", "injection", "drops", "solution", "film", "coated",
  "softgels", "softgel", "oral", "for", "and", "with", "bp", "usp", "ip",
];
const FORM_WORD_RE = new RegExp(`\\b(?:${FORM_WORDS.join("|")})\\b`, "g");

/** Cleaned name with strengths/units and dosage-form words removed. */
export function nameOnlyOf(name: string): string {
  let s = (name || "").toLowerCase();
  s = s.replace(/w\s*\/\s*[vw]/g, " ");
  s = s.replace(/\d+(?:\.\d+)?(?:\s*(?:mg|mcg|gm|g|ml|iu|%)(?![a-z]))?/g, " ");
  s = s.replace(/%/g, " ");
  s = s.replace(/\b(?:mg|mcg|gm|g|ml|iu)\b/g, " ");
  s = s.replace(FORM_WORD_RE, " ");
  return cleanStr(s);
}

/** Sorted numeric tokens, decimal points kept so 1.5 != 15. */
function numbersKey(text: string): string {
  return ((text || "").match(/\d+(?:\.\d+)?/g) || []).slice().sort().join("|");
}

function formsOf(text: string): string {
  const t = (text || "").toLowerCase();
  const set: string[] = [];
  if (/\b(?:tablets?|tabs?|caplets?)\b/.test(t)) set.push("tablet");
  if (/\b(?:capsules?|caps?|softgels?)\b/.test(t)) set.push("capsule");
  if (/\b(?:syrup|suspension|elixir|mixture|expectorant|drops?)\b/.test(t)) set.push("liquid");
  if (/\b(?:cream|ointment|gel)\b/.test(t)) set.push("topical");
  return set.join(",");
}

function variantOf(name: string): string {
  const t = (name || "").toLowerCase().trim();
  const women = /\b(?:women'?s?|womens?|female|ladies)\b/.test(t);
  const men = /\b(?:men'?s?|mens?|male)\b/.test(t);
  const gender = women ? "w" : men ? "m" : "";
  const forte = /\bforte\b/.test(t) ? "f" : "";
  const softgel = /\bsoftgels?\b/.test(t) ? "s" : "";
  const suffix = (t.match(/-\s*(\d+)\s*$/) || [])[1] || "";
  // a hyphen + single letter ("Betamethasone-N", "Tuxil-N") marks a different formulation
  const hyphenLetter = /-\s*[a-z]\b/.test(t) ? "h" : "";
  return `${gender}|${forte}|${softgel}|${suffix}|${hyphenLetter}`;
}

/** Digits only; a 14-digit code drops its leading packaging digit; leading zeros dropped. */
export function normalizeBarcode(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 14) d = d.slice(1);
  return d.replace(/^0+/, "");
}

// ---------- union-find ----------

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface Item {
  id: string;
  category: string;
  norm: string; // name+brand+size
  nameN: string;
  brandN: string;
  sizeN: string;
  nameOnly: string;
  numbers: string;
  forms: string;
  variant: string;
  barcode: string; // normalized
  retailPrice: number;
  rawBarcode: string;
}

const TIER_RANK: Record<GroupTier, number> = { exact: 0, strict_fuzzy: 1, barcode: 2 };

function linkType(a: Item, b: Item): GroupTier | null {
  if (a.category !== b.category) return null;
  if (a.forms && b.forms && a.forms !== b.forms) return null;
  if (a.variant !== b.variant) return null;

  if (a.norm.length > 0 && a.norm === b.norm) return "exact";

  if (
    a.nameOnly.length > 0 &&
    b.nameOnly.length > 0 &&
    a.numbers === b.numbers &&
    (a.brandN === b.brandN || diceSimilarity(a.brandN, b.brandN) >= 0.88) &&
    diceSimilarity(a.nameOnly, b.nameOnly) >= 0.9
  ) {
    return "strict_fuzzy";
  }

  if (
    a.barcode &&
    a.barcode === b.barcode &&
    a.numbers === b.numbers &&
    diceSimilarity(a.nameN, b.nameN) >= 0.8
  ) {
    return "barcode";
  }
  return null;
}

/** Ids of products that originated from the phone-snap flow (have a linked AiDraftProduct). */
export async function getSnapProductIds(pharmacyId: string, branchId: string): Promise<Set<string>> {
  const ids = await AiDraftProduct.distinct("productId", {
    pharmacyId: oid(pharmacyId),
    branchId: oid(branchId),
    productId: { $ne: null },
  });
  return new Set(ids.map((x: unknown) => String(x)));
}

export async function computeGroups(pharmacyId: string, branchId: string): Promise<ComputedGroup[]> {
  const scope = { pharmacyId: oid(pharmacyId), branchId: oid(branchId) };
  const snapIds = await getSnapProductIds(pharmacyId, branchId);
  if (snapIds.size < 2) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = await Product.find(scope)
    .select("itemName brand size category retailPrice barcode")
    .lean<any[]>();

  const items: Item[] = [];
  for (const p of products) {
    const id = String(p._id);
    if (!snapIds.has(id)) continue;
    const name = String(p.itemName ?? "");
    const brand = String(p.brand ?? "");
    const size = String(p.size ?? "");
    items.push({
      id,
      category: String(p.category ?? ""),
      norm: cleanStr(`${name} ${brand} ${size}`),
      nameN: cleanStr(name),
      brandN: cleanStr(brand),
      sizeN: cleanStr(size),
      nameOnly: nameOnlyOf(name),
      numbers: numbersKey(`${name} ${size}`),
      forms: formsOf(`${name} ${size}`),
      variant: variantOf(name),
      barcode: normalizeBarcode(p.barcode),
      retailPrice: Number(p.retailPrice) || 0,
      rawBarcode: String(p.barcode ?? ""),
    });
  }
  if (items.length < 2) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dismissed = await DuplicateReviewDecision.find({ ...scope, decision: "not_duplicate" })
    .select("productIdA productIdB")
    .lean<any[]>();
  const dismissedPairs = new Set(dismissed.map((d) => `${d.productIdA}_${d.productIdB}`));
  const isDismissed = (x: string, y: string) => {
    const [a, b] = [x, y].sort();
    return dismissedPairs.has(`${a}_${b}`);
  };

  // Candidate blocking: first 4 letters of name-only, identical full normalization, same barcode.
  const buckets: Map<string, number[]>[] = [new Map(), new Map(), new Map()];
  items.forEach((it, i) => {
    const keys = [it.nameOnly.slice(0, 4), it.norm, it.barcode];
    keys.forEach((k, bi) => {
      if (!k) return;
      const arr = buckets[bi].get(k);
      if (arr) arr.push(i);
      else buckets[bi].set(k, [i]);
    });
  });

  const uf = new UnionFind(items.length);
  const edges: { i: number; j: number; type: GroupTier }[] = [];
  const seen = new Set<number>();
  const n = items.length;
  for (const bucketMap of buckets) {
    for (const idxs of bucketMap.values()) {
      for (let x = 0; x < idxs.length; x++) {
        for (let y = x + 1; y < idxs.length; y++) {
          const i = Math.min(idxs[x], idxs[y]);
          const j = Math.max(idxs[x], idxs[y]);
          const pk = i * n + j;
          if (seen.has(pk)) continue;
          seen.add(pk);
          if (isDismissed(items[i].id, items[j].id)) continue;
          const type = linkType(items[i], items[j]);
          if (!type) continue;
          uf.union(i, j);
          edges.push({ i, j, type });
        }
      }
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const arr = byRoot.get(r);
    if (arr) arr.push(i);
    else byRoot.set(r, [i]);
  }
  const tierByRoot = new Map<number, GroupTier>();
  for (const e of edges) {
    const r = uf.find(e.i);
    const cur = tierByRoot.get(r);
    if (!cur || TIER_RANK[e.type] > TIER_RANK[cur]) tierByRoot.set(r, e.type);
  }

  const groups: ComputedGroup[] = [];
  for (const [root, idxs] of byRoot) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => items[i]);
    const prices = new Set(members.map((m) => m.retailPrice).filter((v) => v > 0));
    const barcodes = new Set(members.map((m) => m.barcode).filter(Boolean));
    groups.push({
      groupKey: makeGroupKey(members.map((m) => m.id)),
      productIds: members.map((m) => m.id).sort(),
      tier: tierByRoot.get(root) ?? "exact",
      hasPrice: prices.size > 0,
      flags: {
        brandDiffers: new Set(members.map((m) => m.brandN)).size > 1,
        sizeDiffers: new Set(members.map((m) => m.sizeN)).size > 1,
        priceConflict: prices.size > 1,
        barcodeConflict: barcodes.size > 1,
      },
    });
  }
  return groups;
}

export interface RefreshCounts {
  computed: number;
  created: number;
  reopened: number;
  updated: number;
  resolved: number;
  skippedNotSame: number;
}

export async function refreshGroups(pharmacyId: string, branchId: string): Promise<RefreshCounts> {
  const scope = { pharmacyId: oid(pharmacyId), branchId: oid(branchId) };
  const computed = await computeGroups(pharmacyId, branchId);
  const now = new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await TriageDuplicateGroup.find(scope).select("groupKey status").lean<any[]>();
  const statusByKey = new Map<string, string>(existing.map((g) => [g.groupKey, g.status]));

  const counts: RefreshCounts = {
    computed: computed.length, created: 0, reopened: 0, updated: 0, resolved: 0, skippedNotSame: 0,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: any[] = [];
  const computedKeys = new Set<string>();

  for (const g of computed) {
    computedKeys.add(g.groupKey);
    const status = statusByKey.get(g.groupKey);
    const data = {
      productIds: g.productIds.map(oid),
      tier: g.tier,
      hasPrice: g.hasPrice,
      flags: g.flags,
      computedAt: now,
    };
    if (status === "not_same") {
      counts.skippedNotSame++; // never reopen a human "not the same" decision
      continue;
    }
    if (!status) {
      counts.created++;
      ops.push({
        updateOne: {
          filter: { ...scope, groupKey: g.groupKey },
          update: { $set: data, $setOnInsert: { ...scope, groupKey: g.groupKey, status: "open" } },
          upsert: true,
        },
      });
    } else if (status === "resolved") {
      counts.reopened++;
      ops.push({
        updateOne: {
          filter: { ...scope, groupKey: g.groupKey },
          update: { $set: { ...data, status: "open", decidedByUserId: null, decidedAt: null } },
        },
      });
    } else {
      counts.updated++;
      ops.push({
        updateOne: { filter: { ...scope, groupKey: g.groupKey }, update: { $set: data } },
      });
    }
  }

  for (const g of existing) {
    if (g.status === "open" && !computedKeys.has(g.groupKey)) {
      counts.resolved++;
      ops.push({
        updateOne: {
          filter: { ...scope, groupKey: g.groupKey },
          update: { $set: { status: "resolved", decidedAt: now } },
        },
      });
    }
  }

  if (ops.length) await TriageDuplicateGroup.bulkWrite(ops);
  return counts;
}
