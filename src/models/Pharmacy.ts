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
  },
  { timestamps: true }
);

export type PharmacyDoc = InferSchemaType<typeof PharmacySchema>;

export default (models.Pharmacy as Model<PharmacyDoc>) ||
  model<PharmacyDoc>("Pharmacy", PharmacySchema);
