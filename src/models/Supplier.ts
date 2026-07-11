import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const SupplierSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true }, // lowercased name, for case-insensitive matching
    phoneNumber: { type: String, default: "" },
    totalSupplyAmount: { type: Number, required: true, default: 0 },
    lastSupplyAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Pharmacy-wide, not per-store — a supplier can supply more than one bulk store.
SupplierSchema.index({ pharmacyId: 1, nameKey: 1 }, { unique: true });

export type SupplierDoc = InferSchemaType<typeof SupplierSchema>;

export default (models.Supplier as Model<SupplierDoc>) || model<SupplierDoc>("Supplier", SupplierSchema);
