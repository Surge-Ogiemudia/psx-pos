import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import { claimKeys } from "@/lib/triageV2/claims";

export async function POST(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    await dbConnect();
    const body = (await request.json()) as { branchId?: string; keys?: string[]; operator?: string };
    const scope = getBranchScope(session, body.branchId);
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    const owner = String(body.operator ?? "").trim().slice(0, 40) || session.user.id;
    const result = await claimKeys(scope, { id: session.user.id, name: session.user.name ?? "Unknown" }, owner, keys);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
