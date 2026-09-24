import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { getMainPsxUrl } from "@/lib/mainPsx";
import { signEditApproval } from "@/lib/adminApproval";

export async function GET(req: Request) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    // Fetch all admins for this pharmacy to populate the dropdown
    const admins = await User.find({ 
      pharmacyId: session.user.pharmacyId, 
      role: "admin" 
    }).select("name phoneNumber").lean();

    return NextResponse.json({ admins });
  } catch (error) {
    console.error("Admin list error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password, userId, productId } = await req.json();
    if (!password || !userId) {
      return NextResponse.json({ error: "Password and User ID required" }, { status: 400 });
    }

    await dbConnect();
    
    // Check the specific admin selected
    const admin = await User.findOne({ 
      _id: userId,
      pharmacyId: session.user.pharmacyId, 
      role: "admin" 
    }).select("passwordHash phoneNumber name").lean();


    if (!admin) {
      return NextResponse.json({ error: "Invalid admin account" }, { status: 401 });
    }

    // On success, also hand back a short-lived token that lets a staff session save ONE edit to
    // this product (checked by PATCH /api/products/[id]).
    const ok = () =>
      NextResponse.json({
        success: true,
        ...(productId
          ? {
              approvalToken: signEditApproval({
                adminId: String(admin._id),
                adminName: (admin as { name?: string }).name || "Admin",
                pharmacyId: String(session.user.pharmacyId),
                productId: String(productId),
              }),
            }
          : {}),
      });

    // Attempt to verify against Main PSX (source of truth for admin/pharmacy accounts)
    try {
      if (admin.phoneNumber) {
        const mainPsxUrl = getMainPsxUrl();
        const loginRes = await fetch(`${mainPsxUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: admin.phoneNumber, password })
        });
        if (loginRes.ok) {
          return ok();
        }
        
        const errData = await loginRes.json().catch(() => ({}));
        // We tried Main PSX and it explicitly rejected the credentials.
        return NextResponse.json({ 
          error: `Verification failed for ${admin.phoneNumber}. Server says: ${errData.error || 'Invalid credentials'}` 
        }, { status: 401 });
      }
    } catch (e) {
      console.error("Main PSX verification fallback triggered:", e);
    }

    if (!admin.passwordHash) {
      return NextResponse.json({ error: "Local admin account missing password hash, and Main PSX verification failed/unreachable." }, { status: 401 });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (isMatch) {
      return ok();
    }

    return NextResponse.json({ error: "Incorrect admin password" }, { status: 401 });
  } catch (error) {
    console.error("Admin verify error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
