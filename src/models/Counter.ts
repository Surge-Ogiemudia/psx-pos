import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const CounterSchema = new Schema({
  _id: { type: String, required: true }, // Format: pharmacyId:YYYYMMDD
  seq: { type: Number, default: 0 }
});

export type CounterDoc = InferSchemaType<typeof CounterSchema>;

export default (models.Counter as Model<CounterDoc>) || model<CounterDoc>("Counter", CounterSchema);
