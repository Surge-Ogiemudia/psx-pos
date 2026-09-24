import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope, ApiAuthError } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import DuplicateReviewDecision from "@/models/DuplicateReviewDecision";
import TriageDuplicateGroup from "@/models/TriageDuplicateGroup";
import TriageActionLog from "@/models/TriageActionLog";

const oid = (s: string) => new mongoose.Types.ObjectId(s);

export async function POST(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    await dbConnect();
    const body = (await request.json()) as { groupId: string; branchId?: string };
    const scope = getBranchScope(session, body.branchId);
    if (!mongoose.isValidObjectId(body.groupId)) throw new ApiAuthError(400, "Invalid groupId");
    const scopeQ = { pharmacyId: oid(scope.pharmacyId), branchId: oid(scope.branchId) };
    const actorName = session.user.name ?? "Unknown";

    const dbSession = await mongoose.startSession();
    let pairs = 0;
    try {
      await dbSession.withTransaction(async () => {
        const group = await TriageDuplicateGroup.findOne({ _id: oid(body.groupId), ...scopeQ })
          .session(dbSession)
          .lean();
        if (!group) throw new ApiAuthError(404, "Group not found");
        if (group.status !== "open") throw new ApiAuthError(409, "Group is no longer open");

        const ids = group.productIds.map((x) => String(x));
        const now = new Date();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ops: any[] = [];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const [a, b] = [ids[i], ids[j]].sort();
            ops.push({
              updateOne: {
                filter: { ...scopeQ, productIdA: oid(a), productIdB: oid(b) },
                update: {
                  $set: { decision: "not_duplicate", reviewedByUserId: oid(session.user.id), reviewedAt: now },
                  $setOnInsert: { ...scopeQ, productIdA: oid(a), productIdB: oid(b) },
                },
                upsert: true,
              },
            });
          }
        }
        pairs = ops.length;
        if (ops.length) await DuplicateReviewDecision.bulkWrite(ops, { session: dbSession });

        await TriageDuplicateGroup.updateOne(
          { _id: group._id },
          { $set: { status: "not_same", decidedByUserId: oid(session.user.id), decidedAt: now } },
          { session: dbSession }
        );
        await TriageActionLog.create(
          [
            {
              pharmacyId: scope.pharmacyId,
              branchId: scope.branchId,
              actionType: "not_same",
              actorUserId: session.user.id,
              actorName,
              groupId: group._id,
              productIds: group.productIds,
              preImage: { group: { status: group.status, productIds: ids, groupKey: group.groupKey } },
              payload: { pairs: ops.length },
            },
          ],
          { session: dbSession }
        );
      });
    } finally {
      await dbSession.endSession();
    }
    return NextResponse.json({ success: true, pairsRecorded: pairs });
  } catch (error) {
    return handleApiError(error);
  }
}
