import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Persists an operator's "these are not duplicates" call from the Monak Triage duplicate
// review tab, so the same pair never gets flagged again by the /api/products/duplicates
// detection scan. Stored per PAIR, not per group — a group of 3+ possible duplicates is
// dismissed by writing one of these for every pairwise combination in the group.
const DuplicateReviewDecisionSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    // Always the lexicographically smaller of the two product ids (as strings), and
    // productIdB the larger — normalizing the order here means a pair is stored (and
    // looked up) exactly once regardless of which order the detection scan compared them in.
    productIdA: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productIdB: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    decision: { type: String, enum: ["not_duplicate"], required: true, default: "not_duplicate" },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

DuplicateReviewDecisionSchema.index(
  { pharmacyId: 1, branchId: 1, productIdA: 1, productIdB: 1 },
  { unique: true }
);

export type DuplicateReviewDecisionDoc = InferSchemaType<typeof DuplicateReviewDecisionSchema>;

export default (models.DuplicateReviewDecision as Model<DuplicateReviewDecisionDoc>) ||
  model<DuplicateReviewDecisionDoc>("DuplicateReviewDecision", DuplicateReviewDecisionSchema);
