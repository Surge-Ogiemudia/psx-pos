import mongoose from "mongoose";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";
import DeletionLog from "@/models/DeletionLog";
import TriageDuplicateGroup from "@/models/TriageDuplicateGroup";
import TriageActionLog from "@/models/TriageActionLog";
import { ApiAuthError } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";
import { makeGroupKey } from "./groups";
import { unitsRefundedByProduct, unitsSoldByProduct } from "./stats";

export interface MergeInput {
  groupId: string;
  keptProductId: string;
  mergeProductIds: string[];
  stockMode: "add" | "keep_one";
  keepOneFromProductId?: string;
  fields: {
    itemName: string;
    brand: string;
    size: string;
    category: string;
    retailPrice: number;
    wholesalePrice: number;
    distributorPrice?: number;
    barcode?: string;
    expiryDate?: string | null;
  };
}

const oid = (s: string) => new mongoose.Types.ObjectId(s);
const bad = (msg: string, status = 400) => new ApiAuthError(status, msg);

function barcodeScore(b: string): number {
  const digits = /^\d+$/.test(b);
  if (!digits) return 0;
  return [8, 12, 13, 14].includes(b.length) ? 100 + b.length : b.length;
}

export async function mergeGroup(args: {
  scope: { pharmacyId: string; branchId: string };
  actor: { id: string; name: string };
  input: MergeInput;
}) {
  const { scope, actor, input } = args;
  const { groupId, keptProductId, stockMode, fields } = input;

  if (!mongoose.isValidObjectId(groupId) || !mongoose.isValidObjectId(keptProductId)) throw bad("Invalid id");
  const mergeIds = Array.from(new Set((input.mergeProductIds ?? []).map(String)));
  if (mergeIds.length < 1 || mergeIds.some((i) => !mongoose.isValidObjectId(i))) {
    throw bad("mergeProductIds must contain at least one valid id");
  }
  if (mergeIds.includes(keptProductId)) throw bad("keptProductId cannot also appear in mergeProductIds");
  if (stockMode !== "add" && stockMode !== "keep_one") throw bad("stockMode must be add or keep_one");
  const allIds = [keptProductId, ...mergeIds];
  if (stockMode === "keep_one") {
    if (!input.keepOneFromProductId || !allIds.includes(input.keepOneFromProductId)) {
      throw bad("keepOneFromProductId is required for keep_one and must be one of the merged copies");
    }
  }

  // ---- field validation ----
  const f = fields ?? ({} as MergeInput["fields"]);
  const itemName = String(f.itemName ?? "").trim();
  const brand = String(f.brand ?? "").trim();
  const size = String(f.size ?? "").trim();
  if (!itemName || !brand || !size) throw bad("itemName, brand and size are required");
  if (!["medicine", "non-medicine", "supermarket"].includes(f.category)) throw bad("Invalid category");
  const retail = Number(f.retailPrice);
  const wholesale = Number(f.wholesalePrice);
  if (!Number.isFinite(retail) || !Number.isFinite(wholesale) || retail < 0 || wholesale < 0) {
    throw bad("Prices must be non-negative numbers");
  }
  if (wholesale > retail) throw bad("Wholesale price cannot exceed retail price");
  if (retail > 0 && wholesale <= 0) throw bad("Wholesale price must be above 0 when retail is set");
  if (f.distributorPrice != null && (!Number.isFinite(Number(f.distributorPrice)) || Number(f.distributorPrice) < 0)) {
    throw bad("distributorPrice must be a non-negative number");
  }
  let explicitExpiry: Date | null = null;
  if (f.expiryDate) {
    explicitExpiry = new Date(f.expiryDate);
    if (isNaN(explicitExpiry.getTime())) throw bad("Invalid expiryDate");
  }

  const scopeQ = { pharmacyId: oid(scope.pharmacyId), branchId: oid(scope.branchId) };
  const dbSession = await mongoose.startSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = null;

  try {
    await dbSession.withTransaction(async () => {
      result = null; // withTransaction may retry this callback

      const group = await TriageDuplicateGroup.findOne({ _id: oid(groupId), ...scopeQ })
        .session(dbSession)
        .lean();
      if (!group) throw bad("Group not found", 404);
      if (group.status !== "open") throw bad("Group is no longer open", 409);
      const memberIds = group.productIds.map((x) => String(x));
      if (!allIds.every((i) => memberIds.includes(i))) throw bad("Products must all be members of the group");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const products = await Product.find({ _id: { $in: allIds.map(oid) }, ...scopeQ })
        .session(dbSession)
        .lean<any[]>();
      if (products.length !== allIds.length) throw bad("One or more products no longer exist", 404);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drafts = await AiDraftProduct.find({ ...scopeQ, productId: { $in: allIds.map(oid) } })
        .select("_id productId")
        .session(dbSession)
        .lean<any[]>();
      const snapSet = new Set(drafts.map((d) => String(d.productId)));
      if (!allIds.every((i) => snapSet.has(i))) throw bad("Only snap-origin products can be merged here");

      const byId = new Map(products.map((p) => [String(p._id), p]));
      const kept = byId.get(keptProductId)!;
      const mergedProducts = mergeIds.map((i) => byId.get(i)!);

      // ---- stock ----
      const sumLive = products.reduce((s, p) => s + (Number(p.quantityInStock) || 0), 0);
      let finalQty = sumLive;
      let recount: { originalCount: number; copies: number } | null = null;
      if (stockMode === "keep_one") {
        const [sold, refunded] = await Promise.all([
          unitsSoldByProduct(scope, allIds, dbSession),
          unitsRefundedByProduct(scope, allIds, dbSession),
        ]);
        const src = byId.get(input.keepOneFromProductId!)!;
        const O =
          (Number(src.quantityInStock) || 0) +
          (sold.get(String(src._id)) ?? 0) -
          (refunded.get(String(src._id)) ?? 0);
        finalQty = Math.max(0, sumLive - (allIds.length - 1) * O);
        recount = { originalCount: O, copies: allIds.length };
      }

      // ---- expiry / barcode ----
      const expiries = products.map((p) => p.expiryDate).filter(Boolean).map((d) => new Date(d));
      const farthest = expiries.length ? new Date(Math.max(...expiries.map((d) => d.getTime()))) : null;
      const expiryDate = explicitExpiry ?? farthest;

      let barcode = String(f.barcode ?? "").trim();
      if (!barcode) {
        const candidates = products.map((p) => String(p.barcode ?? "").trim()).filter(Boolean);
        candidates.sort((a, b) => barcodeScore(b) - barcodeScore(a));
        barcode = candidates[0] ?? "";
      }
      if (barcode && barcode !== String(kept.barcode ?? "").trim()) {
        const clash = await Product.findOne({
          ...scopeQ,
          barcode,
          _id: { $nin: memberIds.map(oid) },
        })
          .select("_id itemName")
          .session(dbSession)
          .lean();
        if (clash) throw bad(`Barcode ${barcode} already belongs to another product (${clash.itemName})`, 409);
      }

      // ---- pre-image (before any write) ----
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batches = await ProductBatch.find({ ...scopeQ, productId: { $in: mergeIds.map(oid) } })
        .select("_id productId")
        .session(dbSession)
        .lean<any[]>();
      const draftsToMove = drafts.filter((d) => mergeIds.includes(String(d.productId)));
      const [salesTouched, refundsTouched] = await Promise.all([
        Sale.find({ ...scopeQ, "items.productId": { $in: mergeIds.map(oid) } })
          .select("_id")
          .session(dbSession)
          .lean(),
        Refund.find({ ...scopeQ, "items.productId": { $in: mergeIds.map(oid) } })
          .select("_id")
          .session(dbSession)
          .lean(),
      ]);
      const preImage = {
        products,
        batchProductIds: Object.fromEntries(batches.map((b) => [String(b._id), String(b.productId)])),
        draftProductIds: Object.fromEntries(draftsToMove.map((d) => [String(d._id), String(d.productId)])),
        saleIds: salesTouched.map((s) => String(s._id)),
        refundIds: refundsTouched.map((s) => String(s._id)),
        group: { productIds: memberIds, groupKey: group.groupKey, status: group.status, hasPrice: group.hasPrice },
      };

      // ---- writes ----
      const mergeOids = mergeIds.map(oid);
      const keptOid = oid(keptProductId);

      // (1) batches keep their _ids and own expiry
      await ProductBatch.updateMany(
        { ...scopeQ, productId: { $in: mergeOids } },
        { $set: { productId: keptOid } },
        { session: dbSession }
      );

      // (2) kept product
      const pull = ["missing_size"] as string[];
      if (!/^unknown/i.test(brand)) pull.push("missing_brand");
      if (retail > 0) pull.push("missing_price");
      if (expiryDate) pull.push("missing_expiry");
      await Product.updateOne(
        { _id: keptOid, ...scopeQ },
        {
          $set: {
            quantityInStock: finalQty,
            itemName,
            brand,
            size,
            category: f.category,
            retailPrice: retail,
            wholesalePrice: wholesale,
            distributorPrice: f.distributorPrice != null ? Number(f.distributorPrice) : kept.distributorPrice ?? 0,
            expiryDate: expiryDate ?? null,
            barcode,
            updatedAt: new Date(),
          },
          $pull: { needsReviewReason: { $in: pull } },
        },
        { session: dbSession }
      );

      // (3) drafts
      await AiDraftProduct.updateMany(
        { ...scopeQ, productId: { $in: mergeOids } },
        { $set: { productId: keptOid } },
        { session: dbSession }
      );

      // (4) sales & refunds history follows the surviving product
      await Sale.updateMany(
        { ...scopeQ, "items.productId": { $in: mergeOids } },
        { $set: { "items.$[el].productId": keptOid } },
        { arrayFilters: [{ "el.productId": { $in: mergeOids } }], session: dbSession, timestamps: false }
      );
      await Refund.updateMany(
        { ...scopeQ, "items.productId": { $in: mergeOids } },
        { $set: { "items.$[el].productId": keptOid } },
        { arrayFilters: [{ "el.productId": { $in: mergeOids } }], session: dbSession, timestamps: false }
      );

      // (5) activity
      const keptLabel = formatProductLabel({ itemName, brand, size } as never);
      const removedLabels = mergedProducts.map((p) => formatProductLabel(p)).join(", ");
      await logActivity(dbSession, {
        pharmacyId: scope.pharmacyId,
        scope: "branch",
        branchId: scope.branchId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "duplicate_merge",
        summary: `Triage v2: merged ${allIds.length} listings of ${keptLabel} into one (${finalQty} in stock, stock mode ${stockMode}); removed: ${removedLabels}`,
        metadata: { stockMode, sumLive, finalQty, removedProductIds: mergeIds },
        refCollection: "Product",
        refId: keptProductId,
      });
      if (recount) {
        await logActivity(dbSession, {
          pharmacyId: scope.pharmacyId,
          scope: "branch",
          branchId: scope.branchId,
          actorUserId: actor.id,
          actorName: actor.name,
          action: "stock_adjustment",
          summary: `Triage v2 recount: ${keptLabel} was one physical count of ${recount.originalCount} published ${recount.copies} times; stock set from ${sumLive} to ${finalQty}`,
          metadata: { ...recount, sumLive, finalQty },
          refCollection: "Product",
          refId: keptProductId,
        });
      }

      // (6) forces POS terminals to fully resync their cached catalog
      await DeletionLog.create(
        [
          {
            pharmacyId: scope.pharmacyId,
            branchId: scope.branchId,
            type: mergedProducts.length > 1 ? "batch" : "single",
            deletedByUserId: actor.id,
            deletedByName: actor.name,
            itemCount: mergedProducts.length,
            summary: `Triage v2 merged ${allIds.length} duplicate listings of ${keptLabel} into one — removed: ${removedLabels}`,
            productSnapshot: mergedProducts.length === 1 ? mergedProducts[0] : null,
          },
        ],
        { session: dbSession }
      );

      // (7)
      await Product.deleteMany({ _id: { $in: mergeOids }, ...scopeQ }, { session: dbSession });

      // (8) group bookkeeping
      const remaining = memberIds.filter((i) => !mergeIds.includes(i));
      let groupStatus: "open" | "resolved" = "resolved";
      if (remaining.length >= 2) {
        const newKey = makeGroupKey(remaining);
        const clash = await TriageDuplicateGroup.findOne({ ...scopeQ, groupKey: newKey, _id: { $ne: group._id } })
          .select("_id")
          .session(dbSession)
          .lean();
        if (!clash) {
          const remRetail = products
            .filter((p) => remaining.includes(String(p._id)))
            .map((p) => (String(p._id) === keptProductId ? retail : Number(p.retailPrice) || 0));
          await TriageDuplicateGroup.updateOne(
            { _id: group._id },
            { $set: { productIds: remaining.map(oid), groupKey: newKey, hasPrice: remRetail.some((v) => v > 0), computedAt: new Date() } },
            { session: dbSession }
          );
          groupStatus = "open";
        }
      }
      if (groupStatus === "resolved") {
        await TriageDuplicateGroup.updateOne(
          { _id: group._id },
          { $set: { status: "resolved", decidedByUserId: oid(actor.id), decidedAt: new Date() } },
          { session: dbSession }
        );
      }

      // (9) undo record
      await TriageActionLog.create(
        [
          {
            pharmacyId: scope.pharmacyId,
            branchId: scope.branchId,
            actionType: "merge",
            actorUserId: actor.id,
            actorName: actor.name,
            groupId: group._id,
            productIds: allIds.map(oid),
            preImage,
            payload: { input, finalQty, sumLive, recount, expiryDate, barcode },
          },
        ],
        { session: dbSession }
      );

      const updated = await Product.findById(keptOid).session(dbSession).lean();
      result = { product: updated, quantityInStock: finalQty, removedProductIds: mergeIds, groupStatus };
    });
  } finally {
    await dbSession.endSession();
  }
  return result;
}
