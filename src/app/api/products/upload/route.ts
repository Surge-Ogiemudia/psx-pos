import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/session";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireApiSession();
    
    // Check role access
    if (!["admin", "pharmacist"].includes(session.user.role)) {
       // Allow admins/pharmacists to upload. Store managers might need it too.
       if (!["store_manager", "store_keeper"].includes(session.user.role)) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
       }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Optional: Validate file type
    if (!file.type.startsWith("image/")) {
        return NextResponse.json(
            { error: "File must be an image" },
            { status: 400 }
        );
    }

    const filename = `${session.user.pharmacyId}/${Date.now()}-${file.name}`;

    // Upload to Vercel Blob
    const blob = await put(filename, file, {
      access: "public",
    });

    return NextResponse.json(blob);
  } catch (error: any) {
    console.error("Upload Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to upload image" },
      { status: 500 }
    );
  }
}
