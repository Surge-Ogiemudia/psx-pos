import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const StoreProductSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    itemName: { type: String, required: true, trim: true, minlength: 1 },
    brand: { type: String, required: true, trim: true, minlength: 1 },
    size: { type: String, required: true, trim: true, minlength: 1 },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], default: "supermarket" },
    imageUrl: { type: String, default: null },
    baseUnitName: { type: String, required: true, default: "piece", trim: true },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

StoreProductSchema.index({ pharmacyId: 1, storeId: 1, itemName: 1, brand: 1, size: 1 }, { unique: true });

export type StoreProductDoc = InferSchemaType<typeof StoreProductSchema>;

export default (models.StoreProduct as Model<StoreProductDoc>) ||
  model<StoreProductDoc>("StoreProduct", StoreProductSchema);
