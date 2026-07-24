import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const BiometricDeviceSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    serialNumber: { type: String, required: true, unique: true },
    name: { type: String, required: true }, // e.g. "Front Door MB460"
    lastSeen: { type: Date, default: null },
    lastLog: { type: String, default: null },
  },
  { timestamps: true }
);

export type BiometricDeviceDoc = InferSchemaType<typeof BiometricDeviceSchema>;

export default (models.BiometricDevice as Model<BiometricDeviceDoc>) || model<BiometricDeviceDoc>("BiometricDevice", BiometricDeviceSchema);
