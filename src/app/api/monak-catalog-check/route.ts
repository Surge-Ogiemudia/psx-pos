import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { fuzzyRank } from "@/lib/fuzzyMatch";
import { isMonakTriageLocked, triageLockedResponse } from "@/lib/monakTriageLock";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Dedicated shelf-duplicate check for Monak Triage's Panel 2 — deliberately separate from
// the shared /api/products search (used live by POS checkout and the Products admin page).
// That route does a literal whole-string substring match, which works fine for a short
// hand-typed checkout query but silently finds nothing once Panel 2's search is auto-seeded
// from a full AI-extracted name (e.g. "Peace Blood Tonic 200ml Peace") that rarely appears
// verbatim inside the shorter catalog itemName ("Peace Blood Tonic") — this is why the
// duplicate flag stopped firing once the AI-read fast lane shipped. Reuses the same
// word-broadening + Dice-coefficient approach already proven on monak-excel1/2.
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (isMonakTriageLocked(session.user.pharmacyId)) return triageLockedResponse();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));

    if (!search) {
      return NextResponse.json({ products: [] });
    }

    const words = search
      .split(/[^a-zA-Z0-9]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2);

    const dbQuery =
      words.length > 0
        ? { ...scope, $or: words.map((w) => ({ itemName: { $regex: escapeRegex(w), $options: "i" } })) }
        : { ...scope, itemName: { $regex: escapeRegex(search), $options: "i" } };

    const candidates = await Product.find(dbQuery)
      .select("itemName brand size imageUrl quantityInStock retailPrice wholesalePrice")
      .limit(300)
      .lean();

    const products = fuzzyRank(search, candidates, (item) => item.itemName ?? "", {
      limit: 5,
      minScore: 0.35,
    });

    return NextResponse.json({ products });
  } catch (error) {
    return handleApiError(error);
  }
}
