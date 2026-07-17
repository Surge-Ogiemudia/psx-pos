import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const AttendanceSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Null when the staff member clocked in without a scheduled shift that day (unscheduled attendance).
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null, index: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    clockInTime: { type: Date, default: null },
    clockOutTime: { type: Date, default: null },
    status: { type: String, enum: ["present", "absent", "late", "half_day", "early_exit"], required: true },
    clockInMethod: { type: String, enum: ["pin", "face"], default: null },
    clockOutMethod: { type: String, enum: ["pin", "face"], default: null },
    overrideReason: { type: String, default: "" },
    actualHoursWorked: { type: Number, default: 0 },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

AttendanceSchema.index({ pharmacyId: 1, userId: 1, date: 1 }, { unique: true });

export type AttendanceDoc = InferSchemaType<typeof AttendanceSchema>;

export default (models.Attendance as Model<AttendanceDoc>) || model<AttendanceDoc>("Attendance", AttendanceSchema);
