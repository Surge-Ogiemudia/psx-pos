import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Refund from "@/models/Refund";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { parseNumeric } from "@/lib/numberInput";

interface RefundItemInput {
  productId: string;
  quantity: number;
}

const PAYMENT_METHODS = ["cash", "card", "mobile_money"] as const;

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const saleId = request.nextUrl.searchParams.get("saleId");
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const query: Record<string, unknown> = { ...scope };
    if (session.user.role === "staff") {
      query.processedByUserId = session.user.id;
    }
    if (saleId) query.saleId = saleId;
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = new Date(from);
      if (to) timestamp.$lte = endOfDay(new Date(to));
      query.timestamp = timestamp;
    }

    const refunds = await Refund.find(query).sort({ timestamp: -1 }).limit(200).lean();
    return NextResponse.json({
      refunds: refunds.map((r) => (r.method ? r : { ...r, method: "cash" })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const saleId = typeof body.saleId === "string" ? body.saleId : "";
    const items: RefundItemInput[] = (Array.isArray(body.items) ? body.items : []).map(
      (item: RefundItemInput) => ({ ...item, quantity: parseNumeric(item.quantity) })
    );
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const method = typeof body.method === "string" ? body.method : "";

    if (!saleId) return NextResponse.json({ error: "saleId is required" }, { status: 400 });
    if (items.length === 0) {
      return NextResponse.json({ error: "Select at least one item to refund" }, { status: 400 });
    }
    if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
      return NextResponse.json({ error: "Invalid refund method" }, { status: 400 });
    }
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        return NextResponse.json({ error: "Invalid refund line item" }, { status: 400 });
      }
    }

    const scope = getBranchScope(session, body.branchId);

    const sale = await Sale.findOne({ _id: saleId, ...scope }).lean();
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    const existingRefunds = await Refund.find({ saleId }).lean();
    const alreadyRefunded: Record<string, number> = {};
    for (const refund of existingRefunds) {
      for (const line of refund.items) {
        const key = line.productId.toString();
        alreadyRefunded[key] = (alreadyRefunded[key] || 0) + line.quantity;
      }
    }

    const refundItems: { productId: string; productName: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];
    let totalAmount = 0;

    for (const item of items) {
      const saleLine = sale.items.find((l) => l.productId.toString() === item.productId);
      if (!saleLine) {
        return NextResponse.json({ error: "Item was not part of this sale" }, { status: 400 });
      }
      const previouslyReturned = alreadyRefunded[item.productId] || 0;
      const remaining = saleLine.quantity - previouslyReturned;
      if (item.quantity > remaining) {
        return NextResponse.json(
          { error: `Only ${remaining} of "${saleLine.productName}" can still be returned from this sale` },
          { status: 400 }
        );
      }
      const lineTotal = saleLine.unitPrice * item.quantity;
      totalAmount += lineTotal;
      refundItems.push({
        productId: item.productId,
        productName: saleLine.productName,
        quantity: item.quantity,
        unitPrice: saleLine.unitPrice,
        lineTotal,
      });
    }

    const dbSession = await mongoose.startSession();
    try {
      let refundDoc;
      await dbSession.withTransaction(async () => {
        for (const item of refundItems) {
          await Product.findOneAndUpdate(
            { _id: item.productId, ...scope },
            { $inc: { quantityInStock: item.quantity } },
            { session: dbSession }
          );
        }

        const created = await Refund.create(
          [
            {
              ...scope,
              saleId,
              items: refundItems,
              totalAmount,
              method,
              reason,
              processedByUserId: session.user.id,
              timestamp: new Date(),
            },
          ],
          { session: dbSession }
        );
        refundDoc = created[0];
      });

      return NextResponse.json({ refund: refundDoc }, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
