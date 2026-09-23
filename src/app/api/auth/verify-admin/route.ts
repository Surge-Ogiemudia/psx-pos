import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password } = await req.json();
    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    await dbConnect();
    // Get all admins for this pharmacy
    const admins = await User.find({ 
      pharmacyId: session.user.pharmacyId, 
      role: "admin" 
    }).select("passwordHash").lean();

    // Check if the provided password matches ANY admin's password
    for (const admin of admins) {
      if (admin.passwordHash) {
        const isMatch = await bcrypt.compare(password, admin.passwordHash);
        if (isMatch) {
          return NextResponse.json({ success: true });
        }
      }
    }

    return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
  } catch (error) {
    console.error("Admin verify error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
