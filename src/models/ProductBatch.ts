import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ProductBatchSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    // Always in the product's base unit, matching Product.quantityInStock's convention.
    quantity: { type: Number, required: true, min: 0 },
    remainingQuantity: { type: Number, required: true, min: 0 },
    batchNumber: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
    // Set when this batch arrived via a bulk-store push, so it can be traced back.
    sourceTransferId: { type: Schema.Types.ObjectId, ref: "StoreTransfer", default: null },
    receivedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

ProductBatchSchema.index({ pharmacyId: 1, branchId: 1, productId: 1, receivedAt: -1 });

export type ProductBatchDoc = InferSchemaType<typeof ProductBatchSchema>;

export default (models.ProductBatch as Model<ProductBatchDoc>) ||
  model<ProductBatchDoc>("ProductBatch", ProductBatchSchema);
