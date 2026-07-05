import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const StoreProductSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ["medicine", "non-medicine", "supermarket"], default: "supermarket" },
    baseUnitName: { type: String, required: true, default: "piece", trim: true },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

StoreProductSchema.index({ pharmacyId: 1, storeId: 1, name: 1 }, { unique: true });

export type StoreProductDoc = InferSchemaType<typeof StoreProductSchema>;

export default (models.StoreProduct as Model<StoreProductDoc>) ||
  model<StoreProductDoc>("StoreProduct", StoreProductSchema);
