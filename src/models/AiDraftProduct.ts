import { Schema, model, models } from "mongoose";

const AiDraftProductSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    
    // Inputs from mobile
    frontImageUrl: { type: String, required: true },
    backImageUrl: { type: String, default: null },
    quantityInStock: { type: Number, required: true, default: 0, min: 0 },
    retailPrice: { type: Number, default: null, min: 0 },
    
    // Processing State
    status: { 
      type: String, 
      enum: ["pending", "processing", "completed", "error"], 
      default: "pending",
      index: true
    },
    errorMsg: { type: String, default: null },
    
    // Final product reference once created
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null }
  },
  { timestamps: true }
);

export const AiDraftProduct = models.AiDraftProduct || model("AiDraftProduct", AiDraftProductSchema);
