import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UnitLevelSchema = new Schema(
  {
    unitName: { type: String, required: true, trim: true },
    unitsPerParent: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const StoreTransferSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    fromStoreId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    destinationType: { type: String, enum: ["store", "branch"], required: true },
    toStoreId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
    toBranchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    storeProductId: { type: Schema.Types.ObjectId, ref: "StoreProduct", required: true },
    storeBatchId: { type: Schema.Types.ObjectId, ref: "StoreBatch", required: true },
    productName: { type: String, required: true },
    unitHierarchySnapshot: { type: [UnitLevelSchema], required: true },
    pushedForm: { type: String, required: true },
    pushedQuantity: { type: Number, required: true, min: 1 },
    baseUnitQuantity: { type: Number, required: true, min: 1 },
    unitPriceAtPushForm: { type: Number, required: true, min: 0 },
    totalValue: { type: Number, required: true, min: 0 },
    initiatedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

StoreTransferSchema.index({ pharmacyId: 1, fromStoreId: 1, timestamp: -1 });
StoreTransferSchema.index({ pharmacyId: 1, toBranchId: 1, timestamp: -1 });
StoreTransferSchema.index({ pharmacyId: 1, toStoreId: 1, timestamp: -1 });

export type StoreTransferDoc = InferSchemaType<typeof StoreTransferSchema>;

export default (models.StoreTransfer as Model<StoreTransferDoc>) ||
  model<StoreTransferDoc>("StoreTransfer", StoreTransferSchema);
