import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ImportBatchSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedByName: { type: String, required: true },
    fileName: { type: String, default: "" },
    // Count at the moment of import — individual items may since have been edited/deleted
    // on their own, so the batch listing shows both this and the live remaining count.
    itemCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

ImportBatchSchema.index({ pharmacyId: 1, branchId: 1, createdAt: -1 });

export type ImportBatchDoc = InferSchemaType<typeof ImportBatchSchema>;

export default (models.ImportBatch as Model<ImportBatchDoc>) ||
  model<ImportBatchDoc>("ImportBatch", ImportBatchSchema);
