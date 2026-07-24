import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const UserSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null, index: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ["admin", "staff", "store_manager", "store_keeper"], required: true },
    phoneNumber: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },

    // Staff Management fields
    employeeId: { type: String, default: null, trim: true, index: true },
    employmentType: { type: String, enum: ["full_time", "part_time", "contract"], default: "full_time" },
    salaryType: { type: String, enum: ["monthly", "hourly"], default: "monthly" },
    salaryAmount: { type: Number, default: 0 },
    bankAccountDetails: {
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      accountName: { type: String, default: "" },
    },
    startDate: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;

export default (models.User as Model<UserDoc>) || model<UserDoc>("User", UserSchema);
