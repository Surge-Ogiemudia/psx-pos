import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const AttendanceSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", required: true, index: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    clockInTime: { type: Date, default: null },
    clockOutTime: { type: Date, default: null },
    status: { type: String, enum: ["present", "absent", "late", "half_day", "early_exit"], required: true },
    overrideReason: { type: String, default: "" },
    actualHoursWorked: { type: Number, default: 0 },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export type AttendanceDoc = InferSchemaType<typeof AttendanceSchema>;

export default (models.Attendance as Model<AttendanceDoc>) || model<AttendanceDoc>("Attendance", AttendanceSchema);
