import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function POST() {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes expiration

    if (!mongoose.connection.db) {
      throw new Error("Database connection not established");
    }

    await mongoose.connection.db.collection("sso_tokens").insertOne({
      token,
      userId: new mongoose.Types.ObjectId(session.user.id),
      expiresAt,
      createdAt: new Date(),
    });

    return NextResponse.json({ token });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: error.status || 500 }
    );
  }
}
