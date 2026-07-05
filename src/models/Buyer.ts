import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BuyerSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true }, // lowercased name, for case-insensitive matching
    buyerType: { type: String, enum: ["distributor", "wholesaler", "retailer"], required: true },
    phoneNumber: { type: String, default: "" },
    totalPurchaseAmount: { type: Number, required: true, default: 0 },
    lastPurchaseAt: { type: Date, default: null },
  },
  { timestamps: true }
);

BuyerSchema.index({ pharmacyId: 1, buyerType: 1, nameKey: 1 }, { unique: true });

export type BuyerDoc = InferSchemaType<typeof BuyerSchema>;

export default (models.Buyer as Model<BuyerDoc>) || model<BuyerDoc>("Buyer", BuyerSchema);
