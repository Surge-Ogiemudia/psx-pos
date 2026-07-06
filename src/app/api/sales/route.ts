import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale, { type SaleDoc } from "@/models/Sale";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { computeBaseUnitsPerLevel } from "@/lib/unitHierarchy";

const PRICE_FIELD: Record<string, "retailPrice" | "wholesalePrice" | "distributorPrice"> = {
  retail: "retailPrice",
  wholesale: "wholesalePrice",
  distributor: "distributorPrice",
};

const PAYMENT_METHODS = ["cash", "card", "mobile_money"] as const;

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const EPS = 0.005;

interface SaleItemInput {
  productId: string;
  quantity: number;
  priceTier: "retail" | "wholesale" | "distributor";
  form?: string;
}

interface PaymentLineInput {
  method: string;
  amount: number;
}

// Legacy sales (pre-split-payments) only have `paymentMethod` — synthesize the new shape
// for the client so it never has to special-case the old documents.
function normalizeSale(sale: Record<string, unknown> & Partial<SaleDoc>) {
  if (Array.isArray(sale.payments) && sale.payments.length > 0) return sale;
  const legacyMethod = (sale as { paymentMethod?: string }).paymentMethod || "cash";
  return {
    ...sale,
    payments: [{ method: legacyMethod, amount: sale.totalAmount }],
    amountTendered: sale.totalAmount,
    changeGiven: 0,
    changeMethod: "cash",
    changeFee: 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");

    const query: Record<string, unknown> = getBranchScope(
      session,
      request.nextUrl.searchParams.get("branchId")
    );
    if (session.user.role === "staff") {
      query.userId = session.user.id;
    }
    if (from || to) {
      const timestamp: Record<string, Date> = {};
      if (from) timestamp.$gte = new Date(from);
      if (to) timestamp.$lte = endOfDay(new Date(to));
      query.timestamp = timestamp;
    }

    const sales = await Sale.find(query).sort({ timestamp: -1 }).limit(200).lean();
    return NextResponse.json({ sales: sales.map(normalizeSale) });
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
    const payments: PaymentLineInput[] = Array.isArray(body.payments) ? body.payments : [];
    const changeFeeInput = Number(body.changeFee ?? 0);
    const changeMethod = PAYMENT_METHODS.includes(body.changeMethod) ? body.changeMethod : "cash";

    if (items.length === 0) {
      return NextResponse.json({ error: "Sale must include at least one item" }, { status: 400 });
    }
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
      }
      if (!PRICE_FIELD[item.priceTier]) {
        return NextResponse.json({ error: "Invalid price tier" }, { status: 400 });
      }
    }
    if (payments.length === 0) {
      return NextResponse.json({ error: "At least one payment line is required" }, { status: 400 });
    }
    for (const p of payments) {
      if (!PAYMENT_METHODS.includes(p.method as (typeof PAYMENT_METHODS)[number])) {
        return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
      }
      if (!Number.isFinite(p.amount) || p.amount <= 0) {
        return NextResponse.json({ error: "Each payment amount must be greater than 0" }, { status: 400 });
      }
    }
    if (!Number.isFinite(changeFeeInput) || changeFeeInput < 0) {
      return NextResponse.json({ error: "Invalid change fee" }, { status: 400 });
    }

    const amountTendered = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    const scope = getBranchScope(session, body.branchId);
    const dbSession = await mongoose.startSession();
    try {
      let saleDoc;
      await dbSession.withTransaction(async () => {
        const saleItems = [];
        let totalAmount = 0;

        for (const item of items) {
          const priceField = PRICE_FIELD[item.priceTier];

          // Stock is always tracked in the base unit, but a product with a unitHierarchy can be
          // sold in any of its forms (e.g. "1 pack" of a product whose base unit is "sachet").
          // Resolve that conversion first so the guarded decrement below uses base units.
          const existingProduct = await Product.findOne(
            { _id: item.productId, ...scope },
            null,
            { session: dbSession }
          );
          if (!existingProduct) {
            throw new Error(`Product not found for item ${item.productId}`);
          }

          let baseQuantity = item.quantity;
          let form: string | null = null;
          let formQuantity: number | null = null;
          if (existingProduct.unitHierarchy?.length && item.form) {
            const piecesPerForm = computeBaseUnitsPerLevel(existingProduct.unitHierarchy)[item.form];
            if (piecesPerForm === undefined) {
              throw new Error(`"${item.form}" is not a valid unit for ${existingProduct.name}`);
            }
            baseQuantity = piecesPerForm * item.quantity;
            form = item.form;
            formQuantity = item.quantity;
          }

          const product = await Product.findOneAndUpdate(
            {
              _id: item.productId,
              ...scope,
              quantityInStock: { $gte: baseQuantity },
            },
            { $inc: { quantityInStock: -baseQuantity } },
            { new: true, session: dbSession }
          );

          if (!product) {
            throw new Error(`Insufficient stock or product not found for item ${item.productId}`);
          }

          const unitPrice = product[priceField] as number;
          const lineTotal = unitPrice * baseQuantity;
          totalAmount += lineTotal;

          saleItems.push({
            productId: product._id,
            productName: product.name,
            quantity: baseQuantity,
            form,
            formQuantity,
            priceTierUsed: item.priceTier,
            unitPrice,
            lineTotal,
          });
        }

        // Total is only known once live prices are read above, so tender/change validation
        // has to happen here rather than before the transaction starts.
        if (amountTendered < totalAmount - EPS) {
          throw new Error("Amount tendered is less than the sale total");
        }
        const changeDue = round2(Math.max(0, amountTendered - totalAmount));
        if (changeFeeInput > changeDue + EPS) {
          throw new Error("Change fee cannot exceed the change due");
        }
        const changeGiven = round2(changeDue - changeFeeInput);

        const created = await Sale.create(
          [
            {
              ...scope,
              userId: session.user.id,
              items: saleItems,
              totalAmount,
              payments: payments.map((p) => ({ method: p.method, amount: round2(p.amount) })),
              amountTendered,
              changeGiven,
              changeMethod: changeGiven > 0 ? changeMethod : "cash",
              changeFee: round2(changeFeeInput),
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
