import mongoose from "mongoose";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";

type Scope = { pharmacyId: string; branchId: string };

async function sumItems(
  model: typeof Sale | typeof Refund,
  scope: Scope,
  productIds: string[],
  dbSession?: mongoose.ClientSession
): Promise<Map<string, number>> {
  const ids = productIds.map((s) => new mongoose.Types.ObjectId(s));
  const agg = model.aggregate([
    {
      $match: {
        pharmacyId: new mongoose.Types.ObjectId(scope.pharmacyId),
        branchId: new mongoose.Types.ObjectId(scope.branchId),
        "items.productId": { $in: ids },
      },
    },
    { $unwind: "$items" },
    { $match: { "items.productId": { $in: ids } } },
    { $group: { _id: "$items.productId", qty: { $sum: "$items.quantity" } } },
  ]);
  if (dbSession) agg.session(dbSession);
  const rows = await agg;
  return new Map(rows.map((r: { _id: unknown; qty: number }) => [String(r._id), r.qty]));
}

export const unitsSoldByProduct = (scope: Scope, ids: string[], s?: mongoose.ClientSession) =>
  sumItems(Sale, scope, ids, s);
export const unitsRefundedByProduct = (scope: Scope, ids: string[], s?: mongoose.ClientSession) =>
  sumItems(Refund, scope, ids, s);
