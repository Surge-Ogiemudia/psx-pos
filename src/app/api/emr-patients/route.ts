import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search") || "";
    const pharmacyId = session.user.pharmacyId;

    const query: Record<string, any> = {
      pharmacyId: new mongoose.Types.ObjectId(pharmacyId),
    };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    if (!mongoose.connection.db) {
      throw new Error("Database connection not established");
    }

    const patients = await mongoose.connection.db
      .collection("patients")
      .find(query)
      .limit(20)
      .toArray();

    return NextResponse.json({
      patients: patients.map((p) => ({
        id: p._id.toString(),
        name: p.fullName,
        phoneNumber: p.phoneNumber,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: error.status || 500 }
    );
  }
}
