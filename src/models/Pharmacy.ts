import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PharmacySchema = new Schema(
  {
    pharmacyName: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: "" },
    brandColor: { type: String, default: "#0f766e" },
    contactInfo: {
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export type PharmacyDoc = InferSchemaType<typeof PharmacySchema>;

export default (models.Pharmacy as Model<PharmacyDoc>) ||
  model<PharmacyDoc>("Pharmacy", PharmacySchema);
