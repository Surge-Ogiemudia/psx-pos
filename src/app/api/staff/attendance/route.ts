import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Attendance from "@/models/Attendance";
import Shift from "@/models/Shift";
import PunchLog from "@/models/PunchLog";
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

    const startDateObj = new Date(start + "T00:00:00");
    const endDateObj = new Date(end + "T23:59:59.999");

    const punchQuery = {
      pharmacyId: session.user.pharmacyId,
      branchId,
      punchTime: { $gte: startDateObj, $lte: endDateObj },
    };

    const [attendance, shifts, punches] = await Promise.all([
      Attendance.find(query).lean(),
      Shift.find(query).lean(),
      PunchLog.find(punchQuery).sort({ punchTime: -1 }).lean(),
    ]);

    return NextResponse.json({ attendance, shifts, punches });
  } catch (error) {
    return handleApiError(error);
  }
}
