import mongoose from "mongoose";
import TriageClaim from "@/models/TriageClaim";

const oid = (s: string) => new mongoose.Types.ObjectId(s);
export const CLAIM_TTL_MS = 10 * 60 * 1000;

/** Keys currently claimed by someone other than `userId`. */
export async function keysClaimedByOthers(scope: { pharmacyId: string; branchId: string }, userId: string) {
  const rows = await TriageClaim.find({
    pharmacyId: oid(scope.pharmacyId),
    branchId: oid(scope.branchId),
    userId: { $ne: oid(userId) },
    expiresAt: { $gt: new Date() },
  })
    .select("key")
    .lean<{ key: string }[]>();
  return new Set(rows.map((r) => r.key));
}

/** Claim (or renew) keys for this user. Returns which are held by someone else. */
export async function claimKeys(
  scope: { pharmacyId: string; branchId: string },
  user: { id: string; name: string },
  keys: string[]
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  const taken: { key: string; by: string }[] = [];
  const mine: string[] = [];
  for (const key of keys.slice(0, 20)) {
    const base = { pharmacyId: oid(scope.pharmacyId), branchId: oid(scope.branchId), key };
    try {
      await TriageClaim.findOneAndUpdate(
        { ...base, $or: [{ userId: oid(user.id) }, { expiresAt: { $lte: now } }] },
        { $set: { userId: oid(user.id), userName: user.name, expiresAt } },
        { upsert: true }
      );
      mine.push(key);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((e as any)?.code !== 11000) throw e;
      const c = await TriageClaim.findOne(base).select("userName").lean<{ userName?: string }>();
      taken.push({ key, by: c?.userName || "another operator" });
    }
  }
  return { mine, taken };
}
