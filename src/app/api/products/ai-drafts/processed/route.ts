import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Review log, not a live queue — capped rather than paginated.
const PROCESSED_LIMIT = 250;

// Feeds Panel 4 ("Processed Items") of Monak Triage: a pharmacy/branch-wide audit log of
// drafts that were already confirmed into the catalog, merged with the resulting Product
// so the UI can show what was saved and flag anything missing brand/size/expiry/price.
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");

    const query: Record<string, unknown> = {
      pharmacyId: session.user.pharmacyId,
      status: "completed",
      productId: { $ne: null },
    };
    if (branchId) query.branchId = branchId;

    const drafts = await AiDraftProduct.find(query)
      .sort({ createdAt: -1 })
      .limit(PROCESSED_LIMIT)
      .lean();

    const productIds = drafts.map((d) => d.productId).filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const products = await Product.find({ _id: { $in: productIds } }).lean<any[]>();
    const productById = new Map(products.map((p) => [String(p._id), p]));

    const items = drafts
      .map((draft) => {
        // The linked product may have since been deleted — skip rather than error, this is
        // a best-effort review log, not a source of truth.
        const product = productById.get(String(draft.productId));
        if (!product) return null;
        return {
          _id: String(draft._id),
          draftId: String(draft._id),
          productId: String(product._id),
          itemName: product.itemName,
          brand: product.brand,
          size: product.size,
          imageUrl: product.imageUrl ?? draft.frontImageUrl ?? null,
          retailPrice: product.retailPrice,
          wholesalePrice: product.wholesalePrice,
          distributorPrice: product.distributorPrice,
          category: product.category,
          expiryDate: product.expiryDate ?? null,
          needsReviewReason: product.needsReviewReason ?? [],
          createdAt: draft.createdAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
