import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale, { type SaleDoc } from "@/models/Sale";
import ProductRequest from "@/models/ProductRequest";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { computeBaseUnitsPerLevel } from "@/lib/unitHierarchy";
import { formatProductLabel, type ProductCategory } from "@/lib/types";
import { parseNumeric } from "@/lib/numberInput";

const CATEGORIES: ProductCategory[] = ["medicine", "non-medicine", "supermarket"];

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
  productId?: string;
  quantity: number;
  priceTier?: "retail" | "wholesale" | "distributor";
  form?: string;
  // A custom line — sold on the spot for an item that isn't in the catalog.
  custom?: boolean;
  itemName?: string;
  brand?: string;
  size?: string;
  category?: string;
  unitPrice?: number;
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
    const items: SaleItemInput[] = (Array.isArray(body.items) ? body.items : []).map(
      (item: SaleItemInput) => ({ ...item, quantity: parseNumeric(item.quantity) })
    );
    const payments: PaymentLineInput[] = (Array.isArray(body.payments) ? body.payments : []).map(
      (p: PaymentLineInput) => ({ ...p, amount: parseNumeric(p.amount) })
    );
    const changeFeeInput = parseNumeric(body.changeFee ?? 0);
    const changeMethod = PAYMENT_METHODS.includes(body.changeMethod) ? body.changeMethod : "cash";

    if (items.length === 0) {
      return NextResponse.json({ error: "Sale must include at least one item" }, { status: 400 });
    }
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
      }
      if (item.custom) {
        if (!item.itemName?.trim()) {
          return NextResponse.json({ error: "Custom item name is required" }, { status: 400 });
        }
        if (!item.brand?.trim()) {
          return NextResponse.json({ error: "Custom item brand is required" }, { status: 400 });
        }
        if (!item.size?.trim()) {
          return NextResponse.json({ error: "Custom item size is required" }, { status: 400 });
        }
        if (!CATEGORIES.includes(item.category as ProductCategory)) {
          return NextResponse.json({ error: "Invalid category for custom item" }, { status: 400 });
        }
        if (!Number.isFinite(item.unitPrice) || (item.unitPrice as number) <= 0) {
          return NextResponse.json({ error: "Custom item price must be greater than 0" }, { status: 400 });
        }
        continue;
      }
      if (!item.productId) {
        return NextResponse.json({ error: "Invalid line item" }, { status: 400 });
      }
      if (!PRICE_FIELD[item.priceTier as string]) {
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

        // Custom lines (items not in the catalog) file a ProductRequest once the sale is
        // created, so admin review has the sale to reconcile against.
        const customLines: { itemName: string; brand: string; size: string; category: ProductCategory; unitPrice: number; quantity: number }[] = [];

        for (const item of items) {
          if (item.custom) {
            const itemName = item.itemName!.trim();
            const brand = item.brand!.trim();
            const size = item.size!.trim();
            const category = item.category as ProductCategory;
            const unitPrice = round2(item.unitPrice as number);
            const lineTotal = round2(unitPrice * item.quantity);
            totalAmount += lineTotal;

            saleItems.push({
              productId: null,
              productName: formatProductLabel({ itemName, brand, size }),
              isCustom: true,
              itemName,
              brand,
              size,
              category,
              quantity: item.quantity,
              form: null,
              formQuantity: null,
              priceTierUsed: "custom",
              unitPrice,
              lineTotal,
            });
            customLines.push({ itemName, brand, size, category, unitPrice, quantity: item.quantity });
            continue;
          }

          const priceField = PRICE_FIELD[item.priceTier as string];

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
              throw new Error(`"${item.form}" is not a valid unit for ${formatProductLabel(existingProduct)}`);
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
            productName: formatProductLabel(product),
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

        if (customLines.length > 0) {
          await ProductRequest.create(
            customLines.map((line) => ({
              ...scope,
              itemName: line.itemName,
              brand: line.brand,
              size: line.size,
              category: line.category,
              requestedPrice: line.unitPrice,
              quantitySold: line.quantity,
              saleId: saleDoc!._id,
              requestedByUserId: session.user.id,
            })),
            { session: dbSession }
          );
        }
      });

      return NextResponse.json({ sale: saleDoc }, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    return handleApiError(error);
  }
}
