import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ScanJob } from "@/models/ScanJob";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const resolvedParams = await params;

    const job = await ScanJob.findOne({
      _id: resolvedParams.id,
      userId: session.user.id,
      pharmacyId: session.user.pharmacyId
    });

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    return NextResponse.json({ job });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const resolvedParams = await params;
    
    const body = await req.json();

    const job = await ScanJob.findOne({
      _id: resolvedParams.id,
      userId: session.user.id,
      pharmacyId: session.user.pharmacyId
    });

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Update fields if provided
    if (body.pages) job.pages = body.pages;
    if (body.workingDataset) job.workingDataset = body.workingDataset;
    if (body.status) job.status = body.status;

    await job.save();

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const resolvedParams = await params;

    const job = await ScanJob.findOneAndDelete({
      _id: resolvedParams.id,
      userId: session.user.id,
      pharmacyId: session.user.pharmacyId
    });

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
