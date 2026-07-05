import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const StoreSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeName: { type: String, required: true, trim: true },
    location: { type: String, default: "" },
  },
  { timestamps: true }
);

StoreSchema.index({ pharmacyId: 1, storeName: 1 });

export type StoreDoc = InferSchemaType<typeof StoreSchema>;

export default (models.Store as Model<StoreDoc>) || model<StoreDoc>("Store", StoreSchema);
