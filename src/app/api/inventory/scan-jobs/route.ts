import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ScanJob } from "@/models/ScanJob";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const branchScope = getBranchScope(session, req.nextUrl.searchParams.get("branchId"));

    const query: any = { status: "in_progress", userId: session.user.id };
    if (branchScope.branchId) {
      query.branchId = branchScope.branchId;
    } else {
      query.pharmacyId = branchScope.pharmacyId;
    }

    // Don't pull down the heavy pdfBase64 for the list view
    const jobs = await ScanJob.find(query).select("-pdfBase64").sort({ updatedAt: -1 });

    return NextResponse.json({ jobs });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const branchScope = getBranchScope(session, req.nextUrl.searchParams.get("branchId"));

    const body = await req.json();
    const { fileName, pdfBase64, headers, pages } = body;

    if (!fileName || !pdfBase64 || !headers || !pages) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const job = new ScanJob({
      pharmacyId: branchScope.pharmacyId,
      branchId: branchScope.branchId,
      userId: session.user.id,
      fileName,
      pdfBase64,
      headers,
      pages,
      workingDataset: [],
      status: "in_progress",
    });

    await job.save();

    return NextResponse.json({ job: { _id: job._id, fileName: job.fileName } });
  } catch (err: any) {
    return handleApiError(err);
  }
}
