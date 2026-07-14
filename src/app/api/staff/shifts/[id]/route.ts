import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Shift from "@/models/Shift";
import { requirePageSession } from "@/lib/session";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = await request.json();

    await dbConnect();
    const shift = await Shift.findOneAndUpdate(
      { _id: id, pharmacyId: session.user.pharmacyId },
      { $set: body },
      { new: true }
    );

    if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    return NextResponse.json({ shift });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await ctx.params;

    await dbConnect();
    const result = await Shift.deleteOne({ _id: id, pharmacyId: session.user.pharmacyId });

    if (result.deletedCount === 0) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
