import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Short-lived "I'm working on this" marker so two operators never get the same Triage v2 item.
// key = duplicate groupId (dup tabs) or productId (price tab). Expires on its own.
const TriageClaimSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    key: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, default: "" },
    // Everyone shares one admin login, so ownership is the operator name picked on screen.
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

TriageClaimSchema.index({ pharmacyId: 1, branchId: 1, key: 1 }, { unique: true });
TriageClaimSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type TriageClaimDoc = InferSchemaType<typeof TriageClaimSchema>;

export default (models.TriageClaim as Model<TriageClaimDoc>) ||
  model<TriageClaimDoc>("TriageClaim", TriageClaimSchema);
