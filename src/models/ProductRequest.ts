import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Filed automatically when a staff member sells an item that isn't in the catalog yet (a
// "custom sale"), so an admin/store manager can reconcile it afterward — either add it as a
// real product, or resolve it as a duplicate of something that already exists (reconciling the
// stock that already left the shelf but was never decremented).
const ProductRequestSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    itemName: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    size: { type: String, required: true, trim: true },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], required: true },
    requestedPrice: { type: Number, required: true, min: 0 },
    quantitySold: { type: Number, required: true, min: 1 },
    saleId: { type: Schema.Types.ObjectId, ref: "Sale", required: true },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "resolved_duplicate", "rejected"],
      default: "pending",
    },
    linkedProductId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" },
  },
  { timestamps: true }
);

ProductRequestSchema.index({ pharmacyId: 1, branchId: 1, status: 1, createdAt: -1 });

export type ProductRequestDoc = InferSchemaType<typeof ProductRequestSchema>;

export default (models.ProductRequest as Model<ProductRequestDoc>) ||
  model<ProductRequestDoc>("ProductRequest", ProductRequestSchema);
