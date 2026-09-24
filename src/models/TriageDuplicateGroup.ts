import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Precomputed duplicate groups among snap-origin products (see lib/triageV2/groups.ts).
const TriageDuplicateGroupSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    // Sorted product ids joined with "-"; unique per pharmacy+branch.
    groupKey: { type: String, required: true },
    productIds: { type: [Schema.Types.ObjectId], ref: "Product", default: [] },
    tier: { type: String, enum: ["exact", "strict_fuzzy", "barcode"], required: true },
    hasPrice: { type: Boolean, default: false },
    flags: {
      brandDiffers: { type: Boolean, default: false },
      sizeDiffers: { type: Boolean, default: false },
      priceConflict: { type: Boolean, default: false },
      barcodeConflict: { type: Boolean, default: false },
    },
    status: { type: String, enum: ["open", "resolved", "not_same"], default: "open" },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    computedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

TriageDuplicateGroupSchema.index({ pharmacyId: 1, branchId: 1, groupKey: 1 }, { unique: true });
TriageDuplicateGroupSchema.index({ pharmacyId: 1, branchId: 1, status: 1 });
TriageDuplicateGroupSchema.index({ pharmacyId: 1, branchId: 1, status: 1, hasPrice: 1, _id: 1 });

export type TriageDuplicateGroupDoc = InferSchemaType<typeof TriageDuplicateGroupSchema>;

export default (models.TriageDuplicateGroup as Model<TriageDuplicateGroupDoc>) ||
  model<TriageDuplicateGroupDoc>("TriageDuplicateGroup", TriageDuplicateGroupSchema);
