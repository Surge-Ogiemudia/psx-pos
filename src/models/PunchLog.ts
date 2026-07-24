import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PunchLogSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deviceSerialNumber: { type: String, required: true },
    punchTime: { type: Date, required: true, index: true },
    punchStatus: { type: Number, required: true }, // 0 = Check-In, 1 = Check-Out, 255 = Auto, etc.
    verifyMode: { type: Number, required: true },  // 1 = Fingerprint, 20/15 = Face, 4 = Card, 0 = Password
  },
  { timestamps: true }
);

// We don't want unique constraints because someone might punch twice in the same second, though unlikely, it's just a log.
// But we should index for fast queries based on date ranges for a specific user.
PunchLogSchema.index({ pharmacyId: 1, userId: 1, punchTime: -1 });

export type PunchLogDoc = InferSchemaType<typeof PunchLogSchema>;

export default (models.PunchLog as Model<PunchLogDoc>) || model<PunchLogDoc>("PunchLog", PunchLogSchema);
