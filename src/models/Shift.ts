import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ShiftSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    scheduledStartTime: { type: String, required: true }, // Format: HH:mm
    scheduledEndTime: { type: String, required: true }, // Format: HH:mm
    type: { type: String, enum: ["morning", "afternoon", "evening", "full_day", "custom"], required: true },
    notes: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export type ShiftDoc = InferSchemaType<typeof ShiftSchema>;

export default (models.Shift as Model<ShiftDoc>) || model<ShiftDoc>("Shift", ShiftSchema);
