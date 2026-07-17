import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Attendance from "@/models/Attendance";
import Shift from "@/models/Shift";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const { searchParams } = request.nextUrl;
    const branchId = searchParams.get("branchId");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!branchId || !start || !end) {
      return NextResponse.json({ error: "branchId, start and end are required" }, { status: 400 });
    }

    const query = {
      pharmacyId: session.user.pharmacyId,
      branchId,
      date: { $gte: start, $lte: end },
    };

    const [attendance, shifts] = await Promise.all([
      Attendance.find(query).lean(),
      Shift.find(query).lean(),
    ]);

    return NextResponse.json({ attendance, shifts });
  } catch (error) {
    return handleApiError(error);
  }
}
