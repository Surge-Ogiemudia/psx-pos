import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { isDuplicateText } from "@/lib/duplicateDetection";

// Panel 1->2: when an operator opens a draft into Panel 2, this finds OTHER still-
// "extracted" drafts (same pharmacy/branch, excluding the one just opened) that look like
// the same physical item. Because the pre-open bulk-publish flow never checked for
// duplicates, a chunk of the still-pending queue is exact-name duplicates of EACH OTHER —
// e.g. "CoQ10 Softgels" exists as 3 separate draft records, each already pointing at its
// own separately-created live Product — and an operator working one has no visibility that
// 2 more identical items are still sitting untouched in the queue.
//
// Read-only: this ONLY detects candidates. Nothing is merged here — see merge-duplicates/
// route.ts, which requires an explicit operator-confirmed list of sibling draft ids before
// writing anything.
//
// Reuses the exact same fuzzy + strength/pack-size guard as the Panel 4 "Possible
// Duplicates" scan (see duplicateDetection.ts) — different strengths/pack sizes must never
// be treated as the same item.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const { pharmacyId } = session.user;

    const draft = await AiDraftProduct.findOne({ _id: id, pharmacyId }).lean();
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const keptProduct = draft.productId
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await Product.findOne({ _id: draft.productId, pharmacyId })
          .select("itemName brand size imageUrl quantityInStock")
          .lean<any>()
      : null;

    const referenceText = `${draft.extractedItemName ?? ""} ${draft.extractedSize ?? ""}`.trim();

    // Nothing to compare against yet (no AI read done), or this draft has no live product
    // of its own to merge others into — either way, no candidates to show.
    if (!referenceText || !keptProduct) {
      return NextResponse.json({
        keptProduct: keptProduct ? { _id: String(keptProduct._id), ...keptProduct } : null,
        siblings: [],
      });
    }

    const candidates = await AiDraftProduct.find({
      pharmacyId,
      branchId: draft.branchId,
      status: "extracted",
      _id: { $ne: draft._id },
      productId: { $ne: null },
    })
      .select("extractedItemName extractedBrand extractedSize frontImageUrl backImageUrl productId createdAt")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .lean<any[]>();

    const matched = candidates.filter((c) =>
      isDuplicateText(referenceText, `${c.extractedItemName ?? ""} ${c.extractedSize ?? ""}`.trim())
    );

    if (matched.length === 0) {
      return NextResponse.json({
        keptProduct: { _id: String(keptProduct._id), ...keptProduct },
        siblings: [],
      });
    }

    // Pull each candidate's LIVE product — not the draft's own stale quantityInStock — since
    // live sales may already have moved stock since bulk-publish created it.
    const productIds = matched.map((c) => c.productId);
    const products = await Product.find({ _id: { $in: productIds }, pharmacyId })
      .select("itemName brand size imageUrl quantityInStock")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .lean<any[]>();
    const productById = new Map(products.map((p) => [String(p._id), p]));

    const siblings = matched
      // A sibling draft's productId can point at a product that's since been deleted/merged
      // away by some other action — skip it rather than surface a candidate with no live
      // stock behind it.
      .filter((c) => productById.has(String(c.productId)))
      .map((c) => {
        const p = productById.get(String(c.productId))!;
        return {
          draftId: String(c._id),
          productId: String(c.productId),
          itemName: p.itemName,
          brand: p.brand,
          size: p.size,
          imageUrl: p.imageUrl ?? null,
          frontImageUrl: c.frontImageUrl ?? null,
          backImageUrl: c.backImageUrl ?? null,
          quantityInStock: p.quantityInStock,
          createdAt: c.createdAt,
        };
      });

    return NextResponse.json({
      keptProduct: { _id: String(keptProduct._id), ...keptProduct },
      siblings,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
