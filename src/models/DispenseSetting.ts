import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const DispenseSettingSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    storeBatchId: { type: Schema.Types.ObjectId, ref: "StoreBatch", required: true, index: true },
    storeProductId: { type: Schema.Types.ObjectId, ref: "StoreProduct", required: true, index: true },
    channel: {
      type: String,
      enum: ["sister_store", "branch", "distributor", "wholesaler", "retailer"],
      required: true,
    },
    priceForm: { type: String, required: true },
    priceAmount: { type: Number, required: true, min: 0 },
    setByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

DispenseSettingSchema.index({ pharmacyId: 1, storeBatchId: 1, channel: 1 }, { unique: true });

export type DispenseSettingDoc = InferSchemaType<typeof DispenseSettingSchema>;

export default (models.DispenseSetting as Model<DispenseSettingDoc>) ||
  model<DispenseSettingDoc>("DispenseSetting", DispenseSettingSchema);
