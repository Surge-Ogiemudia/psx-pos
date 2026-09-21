import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import DeletionLog from "@/models/DeletionLog";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { formatProductLabel } from "@/lib/types";

interface MergePairPayload {
  keptProductId: string;
  retireProductId: string;
  // Operator-confirmed final count after looking at both original quantities — never a
  // blind sum, since two real duplicate snaps can have genuinely different counts (e.g.
  // 54 counted once, 20 counted again later on a second pass) and only a human looking at
  // both photos can say what the real total actually is.
  finalQuantity: number;
}

// The mobile Triage duplicates step: one operator-confirmed merge of two live products that
// turned out to be the same physical item. Always product-to-product now — every draft
// already has its own live product, so there's no separate draft-vs-draft merge path anymore.
export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { pharmacyId } = session.user;
    const { keptProductId, retireProductId, finalQuantity } = (await request.json()) as MergePairPayload;

    if (!keptProductId || !retireProductId) {
      return NextResponse.json({ error: "keptProductId and retireProductId are required" }, { status: 400 });
    }
    if (keptProductId === retireProductId) {
      return NextResponse.json({ error: "Cannot merge a product with itself" }, { status: 400 });
    }
    const parsedQty = Number(finalQuantity);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      return NextResponse.json({ error: "finalQuantity must be a non-negative number" }, { status: 400 });
    }

    const dbSession = await mongoose.startSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let keptProduct: any = null;

    try {
      await dbSession.withTransaction(async () => {
        const kept = await Product.findOne({ _id: keptProductId, pharmacyId }).session(dbSession).lean();
        const retire = await Product.findOne({ _id: retireProductId, pharmacyId }).session(dbSession).lean();
        if (!kept) throw new Error("Kept product not found");
        if (!retire) throw new Error("Product to merge not found — it may have already been merged by someone else");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (String((kept as any).branchId) !== String((retire as any).branchId)) {
          throw new Error("Products span more than one branch");
        }

        keptProduct = await Product.findByIdAndUpdate(
          keptProductId,
          { $set: { quantityInStock: parsedQty } },
          { new: true, session: dbSession }
        );

        await ProductBatch.updateMany(
          { productId: retireProductId },
          { $set: { productId: keptProductId } },
          { session: dbSession }
        );

        // Any draft(s) still pointing at the product being retired must be re-pointed at the
        // kept one and marked completed — otherwise the desktop queue is left with a draft
        // referencing a now-deleted product, exactly the "ghost" bug fixed earlier tonight.
        await AiDraftProduct.updateMany(
          { productId: retireProductId },
          { $set: { productId: keptProductId, status: "completed" } },
          { session: dbSession }
        );

        await DeletionLog.create(
          [
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pharmacyId: (kept as any).pharmacyId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              branchId: (kept as any).branchId,
              type: "single",
              deletedByUserId: session.user.id,
              deletedByName: session.user.name ?? "Unknown",
              itemCount: 1,
              summary: `Monak Triage (Mobile): Merged duplicate ${formatProductLabel(retire)} into ${formatProductLabel(
                keptProduct
              )} (${parsedQty} in stock)`,
              productSnapshot: retire,
            },
          ],
          { session: dbSession }
        );

        await Product.findByIdAndDelete(retireProductId, { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, keptProduct });
  } catch (error) {
    return handleApiError(error);
  }
}
