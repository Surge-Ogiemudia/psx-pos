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
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], required: true, default: "supermarket" },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
    // Always in the smallest (base) unit — e.g. sachets. If set, unitHierarchy[0] is the
    // largest form (e.g. carton) down to the base unit, letting POS sell in any form.
    unitHierarchy: { type: [UnitLevelSchema], default: undefined },
    retailPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    distributorPrice: { type: Number, required: true, min: 0 },
    batchNumber: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
  },
  { timestamps: true }
);

ProductSchema.index({ pharmacyId: 1, branchId: 1, name: 1 });
ProductSchema.index({ pharmacyId: 1, name: "text" });

export type ProductDoc = InferSchemaType<typeof ProductSchema>;

export default (models.Product as Model<ProductDoc>) ||
  model<ProductDoc>("Product", ProductSchema);
