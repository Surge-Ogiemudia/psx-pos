import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import StoreProduct from "@/models/StoreProduct";
import { requireAdminApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Leftover from before StoreProduct's "name" field was split into itemName/brand/size.
// Mongoose only adds indexes declared in the schema — it never drops ones that are no
// longer declared — so this unique index on the now-nonexistent "name" field is still
// sitting in the live database, silently limiting each store to one saved item ever
// (every document indexes as name: null, and the index is unique). One-time cleanup;
// safe to hit more than once — a missing index is treated as already done.
const STALE_INDEX_NAME = "pharmacyId_1_storeId_1_name_1";

export async function GET() {
  try {
    await requireAdminApiSession();
    await dbConnect();

    try {
      await StoreProduct.collection.dropIndex(STALE_INDEX_NAME);
      return NextResponse.json({ dropped: true, index: STALE_INDEX_NAME });
    } catch (err) {
      const code = (err as { code?: number; codeName?: string }).code;
      // IndexNotFound (27) or NamespaceNotFound (26) — nothing to clean up, not an error.
      if (code === 27 || code === 26) {
        return NextResponse.json({ dropped: false, reason: "Index was not present — already clean." });
      }
      throw err;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
