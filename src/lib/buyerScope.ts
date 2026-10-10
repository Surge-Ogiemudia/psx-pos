import Buyer from "@/models/Buyer";

// A branch sees its own customers plus the ones not yet pinned to any branch (customers from
// before branches existed, and bulk-store customers).
export function inBranch(branchId: string) {
  return { $or: [{ branchId }, { branchId: null }] };
}

// Customers used to be unique per pharmacy + type + name; they're now unique per branch too.
// Mongoose adds the new index but never drops the old one, which keeps rejecting a name that
// exists in another branch.
const STALE_INDEX_NAME = "pharmacyId_1_buyerType_1_nameKey_1";

function hitStaleIndex(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  return e?.code === 11000 && typeof e.message === "string" && e.message.includes(STALE_INDEX_NAME);
}

// Buyer.create that clears the old index itself the first time it gets in the way, then retries
// once, so nobody has to run the maintenance link by hand.
export async function createBuyer(doc: Record<string, unknown>) {
  try {
    return await Buyer.create(doc);
  } catch (err) {
    if (!hitStaleIndex(err)) throw err;
    try {
      await Buyer.collection.dropIndex(STALE_INDEX_NAME);
    } catch (dropErr) {
      const code = (dropErr as { code?: number }).code;
      if (code !== 27 && code !== 26) throw dropErr; // 27/26: already gone
    }
    return await Buyer.create(doc);
  }
}
