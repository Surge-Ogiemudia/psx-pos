import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ScanJob } from "@/models/ScanJob";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const query: any = { status: "in_progress", userId: session.user.id, pharmacyId: session.user.pharmacyId };

    // Select all fields since we no longer store heavy base64 strings
    const jobs = await ScanJob.find(query).sort({ updatedAt: -1 });

    return NextResponse.json({ jobs });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await req.json();
    const { fileName, headers, pages } = body;

    if (!fileName || !headers || !pages) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    // Strip thumbnailBase64 to keep payload tiny
    const cleanPages = pages.map((p: any) => ({
      id: p.id,
      status: p.status,
      data: p.data,
      error: p.error
    }));

    const job = new ScanJob({
      pharmacyId: session.user.pharmacyId,
      userId: session.user.id,
      fileName,
      headers,
      pages: cleanPages,
      workingDataset: [],
      status: "in_progress",
    });

    await job.save();

    return NextResponse.json({ job: { _id: job._id, fileName: job.fileName } });
  } catch (err: any) {
    return handleApiError(err);
  }
}
