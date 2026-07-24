import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PharmacySchema = new Schema(
  {
    pharmacyName: { type: String, required: true, trim: true },
    // URL-safe identifier matched against the subdomain (e.g. "monak" for monak.pos.psx.ng) to
    // pick which pharmacy's branding shows on the login page. Not used for auth/data scoping —
    // that's already handled by each user's own pharmacyId, independent of which subdomain they
    // happen to visit.
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    logoUrl: { type: String, default: "" },
    brandColor: { type: String, default: "#0f766e" },
    contactInfo: {
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    shiftSettings: {
      morningStart: { type: String, default: "08:00" },
      morningEnd: { type: String, default: "14:00" },
      afternoonStart: { type: String, default: "14:00" },
      afternoonEnd: { type: String, default: "20:00" },
      eveningStart: { type: String, default: "20:00" },
      eveningEnd: { type: String, default: "08:00" },
      fullDayStart: { type: String, default: "08:00" },
      fullDayEnd: { type: String, default: "20:00" },
    },
    payrollSettings: {
      gracePeriodMinutes: { type: Number, default: 15 },
      lateDeductionType: { type: String, enum: ["fixed", "percentage", "none"], default: "none" },
      lateDeductionAmount: { type: Number, default: 0 },
      absenceDeductionType: { type: String, enum: ["full_day", "half_day", "none"], default: "full_day" },
    },
    attendanceSettings: {
      allowWebClockIn: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export type PharmacyDoc = InferSchemaType<typeof PharmacySchema>;

export default (models.Pharmacy as Model<PharmacyDoc>) ||
  model<PharmacyDoc>("Pharmacy", PharmacySchema);
