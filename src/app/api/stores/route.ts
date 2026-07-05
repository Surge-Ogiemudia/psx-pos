import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import { requireAdminApiSession, requireStoreApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    // All store-role users see every store in the pharmacy — a store_keeper still needs to
    // know its sister stores' names to push stock to them, even though they can't manage them.
    const session = await requireStoreApiSession();
    await dbConnect();

    const stores = await Store.find({ pharmacyId: session.user.pharmacyId })
      .sort({ storeName: 1 })
      .lean();
    return NextResponse.json({ stores });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();

    const body = await request.json();
    const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
    const location = typeof body.location === "string" ? body.location : "";

    if (!storeName) {
      return NextResponse.json({ error: "Store name is required" }, { status: 400 });
    }

    const store = await Store.create({
      pharmacyId: session.user.pharmacyId,
      storeName,
      location,
    });

    return NextResponse.json({ store }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
