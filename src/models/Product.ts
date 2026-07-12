import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UnitLevelSchema = new Schema(
  {
    unitName: { type: String, required: true, trim: true },
    unitsPerParent: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const ProductSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    // The generic/common item name, independent of who makes it or what size it comes in —
    // e.g. "Amlodipine" or "Groundnut oil". Never a free-typed sentence bundling brand/size in.
    itemName: { type: String, required: true, trim: true, minlength: 1 },
    // Manufacturer/company, always required — if not printed on the packaging, look it up.
    brand: { type: String, required: true, trim: true, minlength: 1 },
    // Strength or size (e.g. "5mg", "1L"). Items with no size variation use the literal
    // "Standard" rather than being left blank, so absence is never ambiguous with an unset field.
    size: { type: String, required: true, trim: true, minlength: 1 },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], required: true, default: "supermarket" },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
    // Defaults to ~20% of initial stock at creation (see products/route.ts) so a reorder-point
    // alert works out of the box without every product needing manual configuration — still
    // editable per-product for anyone who wants to be precise about a specific item.
    alertQuantity: { type: Number, required: true, default: 0, min: 0 },
    // Always in the smallest (base) unit — e.g. sachets. If set, unitHierarchy[0] is the
    // largest form (e.g. carton) down to the base unit, letting POS sell in any form.
    unitHierarchy: { type: [UnitLevelSchema], default: undefined },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    distributorPrice: { type: Number, required: true, min: 0 },
    batchNumber: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
    // Set only when this product was created via a bulk file import — lets the whole
    // batch be deleted together in one action instead of one product at a time.
    importBatchId: { type: Schema.Types.ObjectId, ref: "ImportBatch", default: null, index: true },
  },
  { timestamps: true }
);

ProductSchema.index({ pharmacyId: 1, branchId: 1, itemName: 1 });
ProductSchema.index({ pharmacyId: 1, itemName: "text", brand: "text" });

export type ProductDoc = InferSchemaType<typeof ProductSchema>;

export default (models.Product as Model<ProductDoc>) ||
  model<ProductDoc>("Product", ProductSchema);
