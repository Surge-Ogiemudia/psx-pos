import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BatchDrawSchema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: "ProductBatch", required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const SaleItemSchema = new Schema(
  {
    // null for a custom line — an item sold on the spot that isn't in the catalog yet.
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    productName: { type: String, required: true },
    isCustom: { type: Boolean, default: false },
    // Which ProductBatch(es) this line's stock was drawn from, in draw order, so a refund can
    // credit quantity back to the right batch instead of just an aggregate count. Empty for
    // custom lines, and for legacy sales/products that predate batch tracking.
    batchDraws: { type: [BatchDrawSchema], default: [] },
    // Structured fields for custom lines only, carried through so a ProductRequest can be
    // filed without re-parsing the composed productName back apart.
    itemName: { type: String, default: null },
    brand: { type: String, default: null },
    size: { type: String, default: null },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], default: null },
    quantity: { type: Number, required: true, min: 1 }, // always in the product's base unit
    // What the customer actually bought, when the product has a unitHierarchy (e.g. "1 pack" of
    // a product whose base unit is "sachet"). Absent for products with no defined hierarchy.
    form: { type: String, default: null },
    formQuantity: { type: Number, default: null },
    priceTierUsed: { type: String, enum: ["retail", "wholesale", "distributor", "custom"], required: true },
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
    customerId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    customerName: { type: String, default: null },
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
