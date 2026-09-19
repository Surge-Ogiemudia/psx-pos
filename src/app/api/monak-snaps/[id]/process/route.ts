import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import MonakSnap from "@/models/MonakSnap";
import Product from "@/models/Product";
import ProductBatch from "@/models/ProductBatch";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { logActivity } from "@/lib/activityLog";
import { formatProductLabel } from "@/lib/types";

interface ProcessPayload {
  itemName: string;
  brand: string;
  size: string;
  category: "medicine" | "non-medicine" | "supermarket";
  expiryDate: string | null;
  quantity: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice?: number;
  frontImageUrl: string;
  expiryImageUrl: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const { id } = await params;
    const body = (await request.json()) as ProcessPayload;
    const {
      itemName,
      brand,
      size,
      category,
      expiryDate,
      quantity,
      retailPrice,
      wholesalePrice,
      distributorPrice = 0,
      frontImageUrl,
    } = body;

    if (!itemName || !brand || !size || !category) {
      return NextResponse.json(
        { error: "itemName, brand, size, and category are required" },
        { status: 400 }
      );
    }

    const { pharmacyId } = session.user;

    // Find the snap — it carries the branchId it was created under
    const snap = await MonakSnap.findOne({ _id: id, pharmacyId }).lean();
    if (!snap) {
      return NextResponse.json({ error: "Snap not found" }, { status: 404 });
    }

    const branchId = snap.branchId.toString();
    const alertQuantity = Math.max(1, Math.floor(Number(quantity) * 0.2));
    const parsedExpiry = expiryDate ? new Date(expiryDate) : null;
    const parsedQty = Number(quantity);

    const dbSession = await mongoose.startSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let product: any = null;

    try {
      await dbSession.withTransaction(async () => {
        const created = await Product.create(
          [
            {
              pharmacyId,
              branchId,
              itemName: itemName.trim(),
              brand: brand.trim(),
              size: size.trim() || "Standard",
              category,
              imageUrl: frontImageUrl || null,
              quantityInStock: parsedQty,
              alertQuantity,
              retailPrice: Number(retailPrice),
              wholesalePrice: Number(wholesalePrice),
              distributorPrice: Number(distributorPrice),
              costPrice: 0,
              expiryDate: parsedExpiry,
              barcode: "",
              unitHierarchy: [],
            },
          ],
          { session: dbSession }
        );
        product = created[0];

        if (parsedQty > 0) {
          await ProductBatch.create(
            [
              {
                pharmacyId,
                branchId,
                productId: product._id,
                quantity: parsedQty,
                remainingQuantity: parsedQty,
                batchNumber: "",
                expiryDate: parsedExpiry,
                receivedByUserId: session.user.id,
                receivedAt: new Date(),
              },
            ],
            { session: dbSession }
          );
        }

        await logActivity(dbSession, {
          pharmacyId,
          scope: "branch",
          branchId,
          actorUserId: session.user.id,
          actorName: session.user.name ?? "Unknown",
          action: "product_create",
          summary: `Monak Snap: Added ${formatProductLabel(product!)} to the catalog`,
          refCollection: "Product",
          refId: product!._id,
        });

        await MonakSnap.findByIdAndUpdate(
          id,
          { status: "processed", productId: product!._id },
          { session: dbSession }
        );
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ success: true, product });
  } catch (error) {
    return handleApiError(error);
  }
}
