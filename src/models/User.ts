import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UserSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ["admin", "staff"], required: true },
    phoneNumber: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;

export default (models.User as Model<UserDoc>) || model<UserDoc>("User", UserSchema);
