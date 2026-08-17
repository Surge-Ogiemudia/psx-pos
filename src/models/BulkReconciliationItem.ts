import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BulkReconciliationItemSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    excelItemName: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    size: { type: String, required: true, trim: true },
    category: { type: String, default: "supermarket" },
    totalQuantity: { type: Number, required: true, min: 0 },
    expiryDate: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "matched", "created_as_new", "ignored"],
      default: "pending",
      index: true,
    },
    matchedProductId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    suggestedMatches: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        productName: { type: String, required: true },
        score: { type: Number, required: true },
      },
    ],
    matchedAt: { type: Date, default: null },
    matchedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

BulkReconciliationItemSchema.index({ pharmacyId: 1, status: 1, createdAt: -1 });

export type BulkReconciliationItemDoc = InferSchemaType<typeof BulkReconciliationItemSchema>;

export default (models.BulkReconciliationItem as Model<BulkReconciliationItemDoc>) ||
  model<BulkReconciliationItemDoc>("BulkReconciliationItem", BulkReconciliationItemSchema);
