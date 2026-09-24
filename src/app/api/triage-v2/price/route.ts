import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { requireTriageV2Session } from "@/lib/triageV2/flags";
import { savePrice, type PriceInput } from "@/lib/triageV2/priceSave";

export async function POST(request: NextRequest) {
  try {
    const session = await requireTriageV2Session();
    await dbConnect();
    const body = (await request.json()) as PriceInput & { branchId?: string };
    const scope = getBranchScope(session, body.branchId);
    const product = await savePrice({
      scope,
      actor: { id: session.user.id, name: session.user.name ?? "Unknown" },
      input: body,
    });
    return NextResponse.json({ success: true, product });
  } catch (error) {
    return handleApiError(error);
  }
}
