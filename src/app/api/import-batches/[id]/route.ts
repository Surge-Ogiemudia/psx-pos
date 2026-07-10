import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import ImportBatch from "@/models/ImportBatch";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import DeletionLog from "@/models/DeletionLog";
import { requireAdminApiSession, getBranchScope } from "@/lib/session";
import { productsToCsv } from "@/lib/csv";
import { handleApiError } from "@/lib/apiError";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/import-batches/[id]">
) {
  try {
    const session = await requireAdminApiSession();
    await dbConnect();
    const { id } = await ctx.params;

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const batch = await ImportBatch.findOne({ _id: id, ...scope }).lean();
    if (!batch) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }

    const productsToDelete = await Product.find({ importBatchId: id, ...scope }).lean();

    const dbSession = await mongoose.startSession();
    let deletedCount = 0;
    try {
      await dbSession.withTransaction(async () => {
        const result = await Product.deleteMany({ importBatchId: id, ...scope }, { session: dbSession });
        deletedCount = result.deletedCount ?? 0;
        await ProductBatch.deleteMany(
          { productId: { $in: productsToDelete.map((p) => p._id) }, ...scope },
          { session: dbSession }
        );
        await ImportBatch.deleteOne({ _id: id, ...scope }, { session: dbSession });

        if (productsToDelete.length > 0) {
          const label = batch.fileName || "pasted-csv";
          await DeletionLog.create(
            [
              {
                ...scope,
                type: "batch",
                deletedByUserId: session.user.id,
                deletedByName: session.user.name ?? "Unknown",
                itemCount: productsToDelete.length,
                summary: `Deleted batch "${label}" (${productsToDelete.length} item${productsToDelete.length === 1 ? "" : "s"})`,
                csvContent: productsToCsv(productsToDelete),
                csvFileName: `deleted-batch-${label.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`,
              },
            ],
            { session: dbSession }
          );
        }
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ deletedCount });
  } catch (error) {
    return handleApiError(error);
  }
}
