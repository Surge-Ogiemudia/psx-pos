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
    category: { 
      type: String, 
      enum: ["medicine", "non-medicine", "supermarket"], 
      default: "medicine" 
    },
    
    // Processing State
    status: { 
      type: String, 
      enum: ["pending", "processing", "extracted", "completed", "error", "dismissed", "confirming", "skipped"],
      default: "pending",
      index: true
    },
    errorMsg: { type: String, default: null },
    
    // AI Staged Extraction Results
    extractedItemName: { type: String, default: null },
    extractedBrand: { type: String, default: null },
    extractedSize: { type: String, default: null },
    extractedBarcode: { type: String, default: null },
    extractedExpiryDate: { type: Date, default: null },
    needsReviewReason: { type: [String], default: [] },
    isSplitUnique: { type: Boolean, default: false },
    categoryConfirmed: { type: Boolean, default: false },
    priceConfirmed: { type: Boolean, default: false },
    qtyConfirmed: { type: Boolean, default: false },
    expiryConfirmed: { type: Boolean, default: false },

    // Final product reference once created
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null }
  },
  { timestamps: true }
);

// The Triage queue fetch filters by pharmacyId+branchId and sorts by createdAt desc —
// without this, Mongo had no index covering the sort, so it had to load and sort every
// matching document in memory before any .limit() could even apply, making the limit
// useless for speed (confirmed: limiting to 150 was exactly as slow as fetching all 2,765).
// pharmacyId/branchId first since those are the equality filters; status isn't included
// since the query excludes one value ($ne) rather than matching one, which doesn't benefit
// from a compound position the way an equality filter does.
AiDraftProductSchema.index({ pharmacyId: 1, branchId: 1, createdAt: -1 });

export const AiDraftProduct = models.AiDraftProduct || model("AiDraftProduct", AiDraftProductSchema);
