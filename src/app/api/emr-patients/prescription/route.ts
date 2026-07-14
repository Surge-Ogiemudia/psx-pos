import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const patientId = request.nextUrl.searchParams.get("patientId");
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    if (!mongoose.connection.db) {
      throw new Error("Database connection not established");
    }

    const latestEncounter = await mongoose.connection.db
      .collection("encounters")
      .findOne(
        {
          patientId: new mongoose.Types.ObjectId(patientId),
        },
        { sort: { encounterDate: -1 } }
      );

    if (!latestEncounter) {
      return NextResponse.json({ medicines: [] });
    }

    const plan = await mongoose.connection.db
      .collection("management_plans")
      .findOne({
        encounterId: latestEncounter._id,
      });

    if (!plan || !plan.medicinesDispensed) {
      return NextResponse.json({ medicines: [] });
    }

    let medicines = [];
    try {
      medicines = typeof plan.medicinesDispensed === "string" 
        ? JSON.parse(plan.medicinesDispensed) 
        : plan.medicinesDispensed;
    } catch (e) {
      medicines = [];
    }

    return NextResponse.json({ medicines });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal error" },
      { status: error.status || 500 }
    );
  }
}
