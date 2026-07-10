import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const DeletionLogSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    type: { type: String, enum: ["single", "batch", "delete_all"], required: true },
    deletedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedByName: { type: String, required: true },
    itemCount: { type: Number, required: true, default: 0 },
    summary: { type: String, required: true },
    // Single deletes: the full product snapshot, shown inline. Batch/delete-all: left empty —
    // the same data lives in csvContent instead, since showing hundreds of rows inline isn't useful.
    productSnapshot: { type: Schema.Types.Mixed, default: null },
    // CSV in the same column layout as bulk import, so downloading and re-uploading it through
    // "Check file" restores exactly what was deleted, in error or otherwise.
    csvContent: { type: String, default: "" },
    csvFileName: { type: String, default: "" },
  },
  { timestamps: true }
);

DeletionLogSchema.index({ pharmacyId: 1, branchId: 1, createdAt: -1 });

export type DeletionLogDoc = InferSchemaType<typeof DeletionLogSchema>;

export default (models.DeletionLog as Model<DeletionLogDoc>) ||
  model<DeletionLogDoc>("DeletionLog", DeletionLogSchema);
