import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Shift from "@/models/Shift";
import { requirePageSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const session = await requirePageSession();
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const {
      branchId,
      userId,
      userIds: rawUserIds,
      startDate,
      endDate,
      daysOfWeek,
      scheduledStartTime,
      scheduledEndTime,
      type,
      notes,
    } = body;

    if (!branchId || (!userId && (!Array.isArray(rawUserIds) || rawUserIds.length === 0))) {
      return NextResponse.json({ error: "Branch and Staff selection are required." }, { status: 400 });
    }

    if (!startDate || !endDate || !scheduledStartTime || !scheduledEndTime || !type) {
      return NextResponse.json({ error: "Missing required shift fields." }, { status: 400 });
    }

    const userIds: string[] = Array.isArray(rawUserIds) && rawUserIds.length > 0
      ? rawUserIds
      : [userId];

    const selectedDays: number[] = Array.isArray(daysOfWeek) && daysOfWeek.length > 0
      ? daysOfWeek
      : [0, 1, 2, 3, 4, 5, 6];

    const daysSet = new Set(selectedDays);
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return NextResponse.json({ error: "Invalid start or end date range." }, { status: 400 });
    }

    await dbConnect();

    const bulkOps: any[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (!daysSet.has(dayOfWeek)) continue;

      const dateStr = d.toISOString().split("T")[0];

      for (const targetUserId of userIds) {
        bulkOps.push({
          updateOne: {
            filter: {
              pharmacyId: session.user.pharmacyId,
              branchId,
              userId: targetUserId,
              date: dateStr,
            },
            update: {
              $set: {
                pharmacyId: session.user.pharmacyId,
                branchId,
                userId: targetUserId,
                date: dateStr,
                scheduledStartTime,
                scheduledEndTime,
                type,
                notes: notes || "",
                createdBy: session.user.id,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (bulkOps.length === 0) {
      return NextResponse.json({ error: "No matching dates found for the selected days of the week." }, { status: 400 });
    }

    const result = await Shift.bulkWrite(bulkOps);

    const count = (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);

    return NextResponse.json({
      success: true,
      count,
      message: `Successfully scheduled ${count} shift${count === 1 ? "" : "s"}.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
