import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const RefundItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, default: 0, min: 0 },
    costTotal: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false }
);

const RefundSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    receiptNumber: { type: String, required: true, index: true },
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", required: true, index: true },
    items: { type: [RefundItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, default: 0, min: 0 },
    method: { type: String, enum: ["cash", "card", "mobile_money"], required: true },
    reason: { type: String, default: "" },
    processedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

RefundSchema.index({ pharmacyId: 1, branchId: 1, timestamp: -1 });

export type RefundDoc = InferSchemaType<typeof RefundSchema>;

export default (models.Refund as Model<RefundDoc>) || model<RefundDoc>("Refund", RefundSchema);
