import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ActivityLogSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true, index: true },
    scope: { type: String, enum: ["branch", "store"], required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    action: {
      type: String,
      enum: ["intake", "dispense_setting", "push", "sell", "write_off", "store_created", "buyer_created", "delete"],
      required: true,
    },
    summary: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    refCollection: { type: String, default: "" },
    refId: { type: Schema.Types.ObjectId, default: null },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

ActivityLogSchema.index({ pharmacyId: 1, timestamp: -1 });
ActivityLogSchema.index({ pharmacyId: 1, storeId: 1, timestamp: -1 });
ActivityLogSchema.index({ pharmacyId: 1, branchId: 1, timestamp: -1 });

export type ActivityLogDoc = InferSchemaType<typeof ActivityLogSchema>;

export default (models.ActivityLog as Model<ActivityLogDoc>) ||
  model<ActivityLogDoc>("ActivityLog", ActivityLogSchema);
