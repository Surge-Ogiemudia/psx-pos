import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UnitLevelSchema = new Schema(
  {
    unitName: { type: String, required: true, trim: true },
    unitsPerParent: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const StoreSaleSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: "Buyer", required: true, index: true },
    buyerType: { type: String, enum: ["distributor", "wholesaler", "retailer"], required: true },
    storeProductId: { type: Schema.Types.ObjectId, ref: "StoreProduct", required: true },
    storeBatchId: { type: Schema.Types.ObjectId, ref: "StoreBatch", required: true },
    productName: { type: String, required: true },
    unitHierarchySnapshot: { type: [UnitLevelSchema], required: true },
    soldForm: { type: String, required: true },
    soldQuantity: { type: Number, required: true, min: 1 },
    baseUnitQuantity: { type: Number, required: true, min: 1 },
    unitPriceAtSoldForm: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ["cash", "card", "mobile_money"], required: true },
    soldByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

StoreSaleSchema.index({ pharmacyId: 1, storeId: 1, timestamp: -1 });
StoreSaleSchema.index({ pharmacyId: 1, buyerId: 1, timestamp: -1 });

export type StoreSaleDoc = InferSchemaType<typeof StoreSaleSchema>;

export default (models.StoreSale as Model<StoreSaleDoc>) ||
  model<StoreSaleDoc>("StoreSale", StoreSaleSchema);
