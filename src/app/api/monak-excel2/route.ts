import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import MonakExcel2 from "@/models/MonakExcel2";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { fuzzyRank } from "@/lib/fuzzyMatch";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const { pharmacyId } = session.user;

    if (!search) {
      return NextResponse.json({ results: [] });
    }

    // Broaden recall at the DB level: match ANY significant word from the
    // search string as a substring in itemName, so candidates that share at
    // least one meaningful word surface even if the full string doesn't
    // literally appear. Falls back to the original whole-string regex when
    // no usable words are found (e.g. a short/generic query).
    const words = search
      .split(/[^a-zA-Z0-9]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2);

    const dbQuery =
      words.length > 0
        ? {
            pharmacyId,
            $or: words.map((w) => ({
              itemName: { $regex: escapeRegex(w), $options: "i" },
            })),
          }
        : {
            pharmacyId,
            itemName: { $regex: escapeRegex(search), $options: "i" },
          };

    const candidates = await MonakExcel2.find(dbQuery).limit(300).lean();

    const results = fuzzyRank(search, candidates, (item) => item.itemName ?? "", {
      limit: 15,
    });

    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
