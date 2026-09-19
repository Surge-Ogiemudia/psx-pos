import { Schema, model, models } from "mongoose";

const MonakSnapSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    frontImageUrl: { type: String, required: true },
    expiryImageUrl: { type: String, required: true },
    quantity: { type: Number, required: true },
    status: { type: String, enum: ["pending", "processed"], default: "pending" },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null }, // Linked when processed
  },
  { timestamps: true }
);

export default models.MonakSnap || model("MonakSnap", MonakSnapSchema);
