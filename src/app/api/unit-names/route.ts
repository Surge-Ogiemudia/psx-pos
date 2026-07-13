import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import StoreBatch from "@/models/StoreBatch";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { SEED_UNIT_NAMES } from "@/lib/unitNames";

/**
 * Packaging unit names are free text (pharmacy vocabulary is too varied for a fixed list), so
 * this powers autocomplete instead: a starter seed list merged with every unit name this
 * pharmacy has actually typed before, on either side (Catalog or Bulk store) — so a term typed
 * once by anyone shows up as a suggestion for everyone from then on.
 */
export async function GET() {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const pharmacyId = session.user.pharmacyId;
    const [productNames, batchNames] = await Promise.all([
      Product.distinct("unitHierarchy.unitName", { pharmacyId }),
      StoreBatch.distinct("unitHierarchy.unitName", { pharmacyId }),
    ]);

    const seen = new Map<string, string>();
    for (const name of [...SEED_UNIT_NAMES, ...productNames, ...batchNames]) {
      const trimmed = (name || "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
    const unitNames = [...seen.values()].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ unitNames });
  } catch (error) {
    return handleApiError(error);
  }
}
