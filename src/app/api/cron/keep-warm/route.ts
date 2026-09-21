import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { handleApiError } from "@/lib/apiError";

// Experiment: a frequent, trivial ping to keep a serverless instance's cached Mongoose
// connection warm, so real requests land on an already-connected instance instead of
// paying the cost of a brand-new connection to Atlas — confirmed directly to swing from
// ~6s to 146s depending on whether the instance handling the request was cold or warm.
// This doesn't fix the underlying cause (a shared-tier cluster being slow/inconsistent to
// accept new connections), it just tries to make that cold path less frequently hit.
export const maxDuration = 10;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const start = Date.now();
    const mongooseInstance = await dbConnect();
    const db = mongooseInstance.connection.db;
    if (!db) throw new Error("No active database connection");
    await db.command({ ping: 1 });

    return NextResponse.json({ success: true, elapsedMs: Date.now() - start });
  } catch (error) {
    return handleApiError(error);
  }
}
