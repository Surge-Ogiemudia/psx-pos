import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BranchSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchName: { type: String, required: true, trim: true },
    location: { type: String, default: "" },
  },
  { timestamps: true }
);

export type BranchDoc = InferSchemaType<typeof BranchSchema>;

export default (models.Branch as Model<BranchDoc>) ||
  model<BranchDoc>("Branch", BranchSchema);
