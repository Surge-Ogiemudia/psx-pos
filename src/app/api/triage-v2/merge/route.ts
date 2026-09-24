import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import { mergeGroup, type MergeInput } from "@/lib/triageV2/mergeGroup";

export async function POST(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    await dbConnect();
    const body = (await request.json()) as MergeInput & { branchId?: string };
    const scope = getBranchScope(session, body.branchId);
    const result = await mergeGroup({
      scope,
      actor: { id: session.user.id, name: session.user.name ?? "Unknown" },
      input: body,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}
