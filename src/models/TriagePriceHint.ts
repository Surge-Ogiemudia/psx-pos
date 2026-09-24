import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Written by a separate hint-computation job; Triage v2 only reads it.
const HintSchema = new Schema(
  {
    name: { type: String, default: "" },
    retailPrice: { type: Number, default: 0 },
    wholesalePrice: { type: Number, default: 0 },
    distributorPrice: { type: Number, default: 0 },
  },
  { _id: false }
);

const TriagePriceHintSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    hints: { type: [HintSchema], default: [] },
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

TriagePriceHintSchema.index({ pharmacyId: 1, branchId: 1, productId: 1 }, { unique: true });

export type TriagePriceHintDoc = InferSchemaType<typeof TriagePriceHintSchema>;

export default (models.TriagePriceHint as Model<TriagePriceHintDoc>) ||
  model<TriagePriceHintDoc>("TriagePriceHint", TriagePriceHintSchema);
