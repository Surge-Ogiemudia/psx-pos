import mongoose from "mongoose";
import Product from "@/models/Product";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import TriageActionLog from "@/models/TriageActionLog";
import { ApiAuthError } from "@/lib/session";

export interface PriceInput {
  productId: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice?: number;
  brand?: string;
  size?: string;
  itemName?: string;
}

const oid = (s: string) => new mongoose.Types.ObjectId(s);
const bad = (msg: string, status = 400) => new ApiAuthError(status, msg);

export async function savePrice(args: {
  scope: { pharmacyId: string; branchId: string };
  actor: { id: string; name: string };
  input: PriceInput;
}) {
  const { scope, actor, input } = args;
  if (!mongoose.isValidObjectId(input.productId)) throw bad("Invalid productId");
  const retail = Number(input.retailPrice);
  const wholesale = Number(input.wholesalePrice);
  if (!Number.isFinite(retail) || retail <= 0) throw bad("Retail price must be above 0");
  if (!Number.isFinite(wholesale) || wholesale <= 0) throw bad("Wholesale price must be above 0");
  if (wholesale > retail) throw bad("Wholesale price cannot exceed retail price");
  if (input.distributorPrice != null && (!Number.isFinite(Number(input.distributorPrice)) || Number(input.distributorPrice) < 0)) {
    throw bad("distributorPrice must be a non-negative number");
  }

  const scopeQ = { pharmacyId: oid(scope.pharmacyId), branchId: oid(scope.branchId) };
  const dbSession = await mongoose.startSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = null;
  try {
    await dbSession.withTransaction(async () => {
      const before = await Product.findOne({ _id: oid(input.productId), ...scopeQ }).session(dbSession).lean();
      if (!before) throw bad("Product not found", 404);
      const isSnap = await AiDraftProduct.exists({ ...scopeQ, productId: before._id }).session(dbSession);
      if (!isSnap) throw bad("Only snap-origin products can be edited here");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const $set: Record<string, any> = { retailPrice: retail, wholesalePrice: wholesale, updatedAt: new Date() };
      if (input.distributorPrice != null) $set.distributorPrice = Number(input.distributorPrice);
      const pull = ["missing_price"];
      const brand = input.brand?.trim();
      const size = input.size?.trim();
      const itemName = input.itemName?.trim();
      if (brand) {
        $set.brand = brand;
        if (!/^unknown/i.test(brand)) pull.push("missing_brand");
      }
      if (size) {
        $set.size = size;
        pull.push("missing_size");
      }
      if (itemName) $set.itemName = itemName;

      // Never touches quantityInStock.
      await Product.updateOne(
        { _id: before._id, ...scopeQ },
        { $set, $pull: { needsReviewReason: { $in: pull } } },
        { session: dbSession }
      );
      await TriageActionLog.create(
        [
          {
            pharmacyId: scope.pharmacyId,
            branchId: scope.branchId,
            actionType: "price",
            actorUserId: actor.id,
            actorName: actor.name,
            productIds: [before._id],
            preImage: { product: before },
            payload: input,
          },
        ],
        { session: dbSession }
      );
      result = await Product.findById(before._id).session(dbSession).lean();
    });
  } finally {
    await dbSession.endSession();
  }
  return result;
}
