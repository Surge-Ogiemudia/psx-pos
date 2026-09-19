import { Schema, model, models } from "mongoose";

const MonakExcel2Schema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    itemName: { type: String, required: true },
    category: { type: String, default: "" },
    retailPrice: { type: Number, required: true, default: 0 },
    wholesalePrice: { type: Number, required: true, default: 0 },
    distributorPrice: { type: Number, default: 0 },
  },
  { timestamps: true }
);

MonakExcel2Schema.index({ itemName: "text" });

export default models.MonakExcel2 || model("MonakExcel2", MonakExcel2Schema);
