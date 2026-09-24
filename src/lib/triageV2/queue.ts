import mongoose from "mongoose";
import Product from "@/models/Product";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import TriageDuplicateGroup from "@/models/TriageDuplicateGroup";
import TriagePriceHint from "@/models/TriagePriceHint";
import { getSnapProductIds } from "./groups";
import { unitsSoldByProduct } from "./stats";
import { keysClaimedByOthers } from "./claims";

export type QueueTab = "dup_priced" | "dup_unpriced" | "price";

const oid = (s: string) => new mongoose.Types.ObjectId(s);

const PRODUCT_FIELDS =
  "itemName brand size category quantityInStock retailPrice wholesalePrice distributorPrice expiryDate barcode imageUrl createdAt";

export function priceReasons(p: {
  retailPrice?: number; wholesalePrice?: number; brand?: string; size?: string;
}): string[] {
  const reasons: string[] = [];
  const retail = Number(p.retailPrice) || 0;
  const wholesale = Number(p.wholesalePrice) || 0;
  if (retail <= 0) reasons.push("no_price");
  if (wholesale > retail && retail > 0) reasons.push("wholesale_above_retail");
  else if (wholesale <= 0 && retail > 0) reasons.push("no_price");
  if (/^unknown/i.test(String(p.brand ?? "").trim())) reasons.push("unknown_brand");
  if (!String(p.size ?? "").trim()) reasons.push("no_size");
  return Array.from(new Set(reasons));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydrate(scope: { pharmacyId: string; branchId: string }, products: any[]) {
  const ids = products.map((p) => String(p._id));
  if (!ids.length) return [];
  const idObjs = ids.map(oid);
  const scopeQ = { pharmacyId: oid(scope.pharmacyId), branchId: oid(scope.branchId) };

  const [drafts, hints, sold] = await Promise.all([
    AiDraftProduct.find({ ...scopeQ, productId: { $in: idObjs } })
      .select("productId frontImageUrl backImageUrl createdAt")
      .sort({ createdAt: -1 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .lean<any[]>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TriagePriceHint.find({ ...scopeQ, productId: { $in: idObjs } }).lean<any[]>(),
    unitsSoldByProduct(scope, ids),
  ]);

  const photos = new Map<string, { frontImageUrl: string | null; backImageUrl: string | null }>();
  for (const d of drafts) {
    const k = String(d.productId);
    if (!photos.has(k)) {
      photos.set(k, { frontImageUrl: d.frontImageUrl ?? null, backImageUrl: d.backImageUrl ?? null });
    }
  }
  const hintMap = new Map<string, unknown[]>(hints.map((h) => [String(h.productId), h.hints ?? []]));

  return products.map((p) => {
    const id = String(p._id);
    return {
      _id: id,
      itemName: p.itemName,
      brand: p.brand,
      size: p.size,
      category: p.category,
      quantityInStock: p.quantityInStock,
      retailPrice: p.retailPrice,
      wholesalePrice: p.wholesalePrice,
      distributorPrice: p.distributorPrice,
      expiryDate: p.expiryDate ?? null,
      barcode: p.barcode ?? "",
      imageUrl: p.imageUrl ?? null,
      createdAt: p.createdAt,
      unitsSoldEver: sold.get(id) ?? 0,
      photos: photos.get(id) ?? { frontImageUrl: null, backImageUrl: null },
      hints: hintMap.get(id) ?? [],
    };
  });
}

export async function getQueue(opts: {
  pharmacyId: string;
  branchId: string;
  tab: QueueTab;
  limit?: number;
  cursor?: string | null;
  q?: string | null;
  userId?: string | null;
}) {
  const { pharmacyId, branchId, tab } = opts;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const scope = { pharmacyId, branchId };
  const scopeQ = { pharmacyId: oid(pharmacyId), branchId: oid(branchId) };
  const cursorOid = opts.cursor && mongoose.isValidObjectId(opts.cursor) ? oid(opts.cursor) : null;

  // Search: every word must appear in name, brand or size (case-insensitive, escaped).
  const words = String(opts.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  let searchIds: Set<string> | null = null;
  if (words.length) {
    const and = words.map((w) => {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return { $or: [{ itemName: re }, { brand: re }, { size: re }] };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hit = await Product.find({ ...scopeQ, $and: and } as never).select("_id").lean<any[]>();
    searchIds = new Set(hit.map((h) => String(h._id)));
  }

  // Price tab only: items another operator is working on right now are hidden from this operator.
  const claimed = tab === "price" && opts.userId ? await keysClaimedByOthers(scope, opts.userId) : new Set<string>();

  // Open groups: light read (ids only) — used for the price tab exclusion and dup counts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openGroups = await TriageDuplicateGroup.find({ ...scopeQ, status: "open" })
    .select("productIds hasPrice")
    .lean<any[]>();
  const inOpenGroup = new Set<string>();
  let dupPriced = 0;
  let dupUnpriced = 0;
  for (const g of openGroups) {
    if (g.hasPrice) dupPriced++;
    else dupUnpriced++;
    for (const id of g.productIds) inOpenGroup.add(String(id));
  }

  // Price tab candidates: cheap indexed scope query narrowed by the "needs work" conditions,
  // then intersected with snap-origin ids and not-in-open-group in memory.
  const snapIds = await getSnapProductIds(pharmacyId, branchId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceCandidates = await Product.find({
    ...scopeQ,
    $or: [
      { retailPrice: { $lte: 0 } },
      { wholesalePrice: { $lte: 0 } },
      { $expr: { $gt: ["$wholesalePrice", "$retailPrice"] } },
      { brand: { $regex: /^\s*unknown/i } },
      { size: { $regex: /^\s*$/ } },
    ],
  } as never)
    .select(PRODUCT_FIELDS)
    .sort({ _id: 1 })
    .lean<any[]>();
  const priceList = priceCandidates.filter(
    (p) => snapIds.has(String(p._id)) && !inOpenGroup.has(String(p._id))
  );

  const tabCounts = { dup_priced: dupPriced, dup_unpriced: dupUnpriced, price: priceList.length };

  if (tab === "price") {
    let rows = (searchIds ? priceList.filter((p) => searchIds!.has(String(p._id))) : priceList).filter(
      (p) => !claimed.has(String(p._id))
    );
    if (cursorOid) rows = rows.filter((p) => String(p._id) > String(cursorOid));
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? String(page[page.length - 1]._id) : null;
    const hydrated = await hydrate(scope, page);
    const items = hydrated.map((h, i) => ({ ...h, reasons: priceReasons(page[i]) }));
    return { tabCounts, items, nextCursor };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = await TriageDuplicateGroup.find({
    ...scopeQ,
    status: "open",
    hasPrice: tab === "dup_priced",
    ...(searchIds ? { productIds: { $in: Array.from(searchIds).map(oid) } } : {}),
    ...(cursorOid ? { _id: { $gt: cursorOid } } : {}),
  })
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean<any[]>();
  const hasMore = groups.length > limit;
  const pageGroups = groups.slice(0, limit);

  const allIds = Array.from(new Set(pageGroups.flatMap((g) => g.productIds.map((x: unknown) => String(x)))));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prods = allIds.length
    ? await Product.find({ ...scopeQ, _id: { $in: allIds.map(oid) } }).select(PRODUCT_FIELDS).lean<any[]>()
    : [];
  const hydrated = await hydrate(scope, prods);
  const byId = new Map(hydrated.map((h) => [h._id, h]));

  const items = pageGroups.map((g) => ({
    groupId: String(g._id),
    groupKey: g.groupKey,
    tier: g.tier,
    hasPrice: g.hasPrice,
    flags: g.flags,
    computedAt: g.computedAt,
    members: g.productIds.map((x: unknown) => byId.get(String(x))).filter(Boolean),
  }));
  return {
    tabCounts,
    items,
    nextCursor: hasMore ? String(pageGroups[pageGroups.length - 1]._id) : null,
  };
}
