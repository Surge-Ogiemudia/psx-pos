import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Staff identity/passwords live in Main PSX, not this app's User collection, so PIN and
 * face-recognition data for the /clockin kiosk are kept in their own lazily-created record
 * keyed by the Main PSX staff id rather than bolted onto the (mostly unused locally) User model.
 */
const StaffCredentialSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, default: null, index: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    pinHash: { type: String, default: null },
    faceDescriptor: { type: [Number], default: null },
    faceEnrolledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

StaffCredentialSchema.index({ pharmacyId: 1, userId: 1 }, { unique: true });

export type StaffCredentialDoc = InferSchemaType<typeof StaffCredentialSchema>;

export default (models.StaffCredential as Model<StaffCredentialDoc>) ||
  model<StaffCredentialDoc>("StaffCredential", StaffCredentialSchema);
