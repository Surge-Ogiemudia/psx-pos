import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UnitLevelSchema = new Schema(
  {
    unitName: { type: String, required: true, trim: true },
    unitsPerParent: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const StoreBatchSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    storeProductId: { type: Schema.Types.ObjectId, ref: "StoreProduct", required: true, index: true },
    productName: { type: String, required: true },
    unitHierarchy: {
      type: [UnitLevelSchema],
      required: true,
      validate: (v: unknown[]) => v.length > 0,
    },
    receivedForm: { type: String, required: true },
    receivedQuantity: { type: Number, required: true, min: 1 },
    baseUnitQuantity: { type: Number, required: true, min: 0 },
    remainingBaseUnitQuantity: { type: Number, required: true, min: 0 },
    purchaseAmount: { type: Number, required: true, min: 0 },
    purchaseUnitCost: { type: Number, required: true, min: 0 },
    supplierName: { type: String, default: "" },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", default: null },
    batchNumber: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
    sourceTransferId: { type: Schema.Types.ObjectId, ref: "StoreTransfer", default: null },
    receivedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

StoreBatchSchema.index({ pharmacyId: 1, storeId: 1, storeProductId: 1, receivedAt: -1 });

export type StoreBatchDoc = InferSchemaType<typeof StoreBatchSchema>;

export default (models.StoreBatch as Model<StoreBatchDoc>) ||
  model<StoreBatchDoc>("StoreBatch", StoreBatchSchema);
