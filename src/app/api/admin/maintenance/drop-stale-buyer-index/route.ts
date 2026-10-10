import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Customers used to be unique per pharmacy + type + name. They now belong to a branch, so the
// same name can exist in two branches, and uniqueness is per branch. Mongoose adds the new
// index on its own but never drops the old one, which would keep rejecting a name that already
// exists in another branch. One-time cleanup; safe to hit more than once.
const STALE_INDEX_NAME = "pharmacyId_1_buyerType_1_nameKey_1";

export async function GET() {
  try {
    await requireAdminApiSession();
    await dbConnect();

    try {
      await Buyer.collection.dropIndex(STALE_INDEX_NAME);
      return NextResponse.json({ dropped: true, index: STALE_INDEX_NAME });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 27 || code === 26) {
        return NextResponse.json({ dropped: false, reason: "Index was not present — already clean." });
      }
      throw err;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
