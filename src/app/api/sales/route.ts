import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

const PRICE_FIELD: Record<string, "retailPrice" | "wholesalePrice" | "distributorPrice"> = {
  retail: "retailPrice",
  wholesale: "wholesalePrice",
  distributor: "distributorPrice",
};

interface SaleItemInput {
  productId: string;
  quantity: number;
  priceTier: "retail" | "wholesale" | "distributor";
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");

    const query: Record<string, unknown> = {
      pharmacyId: session.user.pharmacyId,
      branchId: session.user.branchId,
    };
    if (session.user.role === "staff") {
      query.userId = session.user.id;
    }
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = new Date(from);
      if (to) timestamp.$lte = new Date(to);
      query.timestamp = timestamp;
    }

    const sales = await Sale.find(query).sort({ timestamp: -1 }).limit(200).lean();
    return NextResponse.json({ sales });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const items: SaleItemInput[] = Array.isArray(body.items) ? body.items : [];
    const paymentMethod = body.paymentMethod;

    if (items.length === 0) {
      return NextResponse.json({ error: "Sale must include at least one item" }, { status: 400 });
    }
    if (!["cash", "card", "mobile_money"].includes(paymentMethod)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
      }
      if (!PRICE_FIELD[item.priceTier]) {
        return NextResponse.json({ error: "Invalid price tier" }, { status: 400 });
      }
    }

    const dbSession = await mongoose.startSession();
    try {
      let saleDoc;
      await dbSession.withTransaction(async () => {
        const saleItems = [];
        let totalAmount = 0;

        for (const item of items) {
          const priceField = PRICE_FIELD[item.priceTier];

          const product = await Product.findOneAndUpdate(
            {
              _id: item.productId,
              pharmacyId: session.user.pharmacyId,
              branchId: session.user.branchId,
              quantityInStock: { $gte: item.quantity },
            },
            { $inc: { quantityInStock: -item.quantity } },
            { new: true, session: dbSession }
          );

          if (!product) {
            throw new Error(`Insufficient stock or product not found for item ${item.productId}`);
          }

          const unitPrice = product[priceField] as number;
          const lineTotal = unitPrice * item.quantity;
          totalAmount += lineTotal;

          saleItems.push({
            productId: product._id,
            productName: product.name,
            quantity: item.quantity,
            priceTierUsed: item.priceTier,
            unitPrice,
            lineTotal,
          });
        }

        const created = await Sale.create(
          [
            {
              pharmacyId: session.user.pharmacyId,
              branchId: session.user.branchId,
              userId: session.user.id,
              items: saleItems,
              totalAmount,
              paymentMethod,
              timestamp: new Date(),
            },
          ],
          { session: dbSession }
        );
        saleDoc = created[0];
      });

      return NextResponse.json({ sale: saleDoc }, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
