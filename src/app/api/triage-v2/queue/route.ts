import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import { getQueue, type QueueTab } from "@/lib/triageV2/queue";

const TABS: QueueTab[] = ["dup_priced", "dup_unpriced", "price"];

export async function GET(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    await dbConnect();
    const sp = request.nextUrl.searchParams;
    const scope = getBranchScope(session, sp.get("branchId"));
    const tab = sp.get("tab") as QueueTab;
    if (!TABS.includes(tab)) {
      return NextResponse.json({ error: "tab must be dup_priced, dup_unpriced or price" }, { status: 400 });
    }
    const result = await getQueue({
      ...scope,
      tab,
      limit: Number(sp.get("limit")) || 50,
      cursor: sp.get("cursor"),
      q: sp.get("q"),
      userId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
