import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import MonakExcel1 from "@/models/MonakExcel1";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const { pharmacyId } = session.user;

    if (!search) {
      return NextResponse.json({ results: [] });
    }

    const results = await MonakExcel1.find({
      pharmacyId,
      itemName: { $regex: search, $options: "i" },
    })
      .limit(15)
      .lean();

    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
