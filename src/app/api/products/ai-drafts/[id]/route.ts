import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Soft dismiss/restore/skip — never hard-deletes a captured snap. "dismissed" hides it from
// the active triage queue while keeping the photos and count on record; "skipped" tags it as
// needing later attention and moves it into the Needs AI bucket; "pending" undoes either one.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;
    const { status } = (await request.json()) as { status?: "dismissed" | "pending" | "skipped" };

    if (status !== "dismissed" && status !== "pending" && status !== "skipped") {
      return NextResponse.json({ error: "status must be 'dismissed', 'pending', or 'skipped'" }, { status: 400 });
    }

    const existing = await AiDraftProduct.findOne({ _id: id, pharmacyId });
    if (!existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (existing.status === "completed") {
      return NextResponse.json({ error: "Already processed" }, { status: 400 });
    }

    const update: Record<string, unknown> = { $set: { status } };
    if (status === "skipped") {
      update.$addToSet = { needsReviewReason: "manual_skip" };
    } else if (status === "pending") {
      update.$pull = { needsReviewReason: "manual_skip" };
    }

    const draft = await AiDraftProduct.findOneAndUpdate({ _id: id, pharmacyId }, update, { new: true });

    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return handleApiError(error);
  }
}
