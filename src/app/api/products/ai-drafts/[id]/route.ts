import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Soft dismiss/restore — never hard-deletes a captured snap. "dismissed" hides it from
// the active triage queue while keeping the photos and count on record; "pending" undoes that.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;
    const { status } = (await request.json()) as { status?: "dismissed" | "pending" };

    if (status !== "dismissed" && status !== "pending") {
      return NextResponse.json({ error: "status must be 'dismissed' or 'pending'" }, { status: 400 });
    }

    const draft = await AiDraftProduct.findOne({ _id: id, pharmacyId });
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (draft.status === "completed") {
      return NextResponse.json({ error: "Already processed" }, { status: 400 });
    }

    draft.status = status;
    await draft.save();

    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return handleApiError(error);
  }
}
