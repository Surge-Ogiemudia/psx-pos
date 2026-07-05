import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const SaleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    priceTierUsed: { type: String, enum: ["retail", "wholesale", "distributor"], required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PaymentLineSchema = new Schema(
  {
    method: { type: String, enum: ["cash", "card", "mobile_money"], required: true },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { _id: false }
);

const SaleSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: { type: [SaleItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    payments: { type: [PaymentLineSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    amountTendered: { type: Number, required: true, min: 0 },
    changeGiven: { type: Number, required: true, default: 0, min: 0 },
    changeMethod: { type: String, enum: ["cash", "card", "mobile_money"], default: "cash" },
    changeFee: { type: Number, required: true, default: 0, min: 0 },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

SaleSchema.index({ pharmacyId: 1, branchId: 1, timestamp: -1 });

export type SaleDoc = InferSchemaType<typeof SaleSchema>;

export default (models.Sale as Model<SaleDoc>) || model<SaleDoc>("Sale", SaleSchema);
