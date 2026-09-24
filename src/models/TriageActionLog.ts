import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Pre-image of every Triage v2 action so it can be undone later.
const TriageActionLogSchema = new Schema(
  {
    pharmacyId: { type: Schema.Types.ObjectId, ref: "Pharmacy", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    actionType: { type: String, enum: ["merge", "price", "not_same"], required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: "TriageDuplicateGroup", default: null },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    // merge: { products: [full docs], batchProductIds: {batchId: oldProductId},
    //          draftProductIds: {draftId: oldProductId}, saleIds: [], refundIds: [], group: {...} }
    // price: { product: <full doc> }
    preImage: { type: Schema.Types.Mixed, default: {} },
    payload: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

TriageActionLogSchema.index({ pharmacyId: 1, branchId: 1, createdAt: -1 });
TriageActionLogSchema.index({ pharmacyId: 1, branchId: 1, productIds: 1 });

export type TriageActionLogDoc = InferSchemaType<typeof TriageActionLogSchema>;

export default (models.TriageActionLog as Model<TriageActionLogDoc>) ||
  model<TriageActionLogDoc>("TriageActionLog", TriageActionLogSchema);
