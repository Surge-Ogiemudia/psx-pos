import mongoose from "mongoose";

const scanJobSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fileName: { type: String, required: true },
  headers: { type: [String], required: true },
  pages: [{
    id: { type: Number, required: true },
    thumbnailBase64: { type: String },
    status: { type: String, enum: ["pending", "processing", "done", "error"], default: "pending" },
    data: { type: mongoose.Schema.Types.Mixed }, // Array of row objects
    error: { type: String }
  }],
  workingDataset: { type: mongoose.Schema.Types.Mixed, default: [] },
  status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" }
}, { timestamps: true });

export const ScanJob = mongoose.models.ScanJob || mongoose.model("ScanJob", scanJobSchema);
