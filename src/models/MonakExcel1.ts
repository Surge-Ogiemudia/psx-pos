import { Schema, model, models } from "mongoose";

const MonakExcel1Schema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    itemName: { type: String, required: true },
    expiryDate: { type: String, default: "" },
    retailPrice: { type: Number, default: 0 },
    wholesalePrice: { type: Number, default: 0 },
    // You can add more fields if needed based on the CSV
  },
  { timestamps: true, collection: "monakexcel1s" }
);

// Create a text index for fast searching
MonakExcel1Schema.index({ itemName: "text" });

export default models.MonakExcel1 || model("MonakExcel1", MonakExcel1Schema);
