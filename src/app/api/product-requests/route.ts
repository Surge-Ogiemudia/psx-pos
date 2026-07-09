import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import ProductRequest from "@/models/ProductRequest";
import User from "@/models/User";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const status = request.nextUrl.searchParams.get("status");
    const query: Record<string, unknown> = { ...scope };
    if (status) query.status = status;

    const requests = await ProductRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    const requesterIds = [...new Set(requests.map((r) => r.requestedByUserId.toString()))];
    const requesters = await User.find({ _id: { $in: requesterIds } }).select("name").lean();
    const nameById = new Map(requesters.map((u) => [u._id.toString(), u.name]));

    return NextResponse.json({
      requests: requests.map((r) => ({
        ...r,
        requestedByName: nameById.get(r.requestedByUserId.toString()) ?? "Unknown",
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
