import mongoose from "mongoose";
import ActivityLog from "@/models/ActivityLog";

interface LogActivityInput {
  pharmacyId: string;
  scope: "branch" | "store";
  branchId?: string | null;
  storeId?: string | null;
  actorUserId: string;
  actorName: string;
  action:
    | "intake"
    | "dispense_setting"
    | "push"
    | "sell"
    | "write_off"
    | "store_created"
    | "buyer_created"
    | "delete"
    | "stock_adjustment";
  summary: string;
  metadata?: Record<string, unknown>;
  refCollection?: string;
  refId?: string | mongoose.Types.ObjectId | null;
}

/**
 * Always call this from inside the same DB transaction as the action it describes,
 * so a log entry and the change it narrates can never go out of sync.
 */
export async function logActivity(dbSession: mongoose.ClientSession, entry: LogActivityInput): Promise<void> {
  await ActivityLog.create(
    [
      {
        pharmacyId: entry.pharmacyId,
        scope: entry.scope,
        branchId: entry.branchId ?? null,
        storeId: entry.storeId ?? null,
        actorUserId: entry.actorUserId,
        actorName: entry.actorName,
        action: entry.action,
        summary: entry.summary,
        metadata: entry.metadata ?? {},
        refCollection: entry.refCollection ?? "",
        refId: entry.refId ?? null,
        timestamp: new Date(),
      },
    ],
    { session: dbSession }
  );
}
