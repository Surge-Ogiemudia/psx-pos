import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ProductSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ["medicine", "non-medicine"], required: true },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
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
