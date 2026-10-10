import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import Branch from "@/models/Branch";
import Sale from "@/models/Sale";
import StoreSale from "@/models/StoreSale";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { inBranch } from "@/lib/buyerScope";

// One customer: their details plus everything they've bought (POS sales and bulk-store sales).
// PATCH edits name/phone. Open to any signed-in POS user, scoped to their branch.

const HISTORY_LIMIT = 100;

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

function customerJson(b: { _id: unknown; name: string; phoneNumber?: string | null; buyerType: string; branchId?: unknown }) {
  return {
    _id: String(b._id),
    name: b.name,
    phoneNumber: b.phoneNumber || "",
    buyerType: b.buyerType,
    branchId: b.branchId ? String(b.branchId) : null,
  };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const { id } = await ctx.params;
    const { pharmacyId, branchId } = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const buyer = await Buyer.findOne({ _id: id, pharmacyId, ...inBranch(branchId) }).lean();
    if (!buyer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const [sales, storeSales, branches] = await Promise.all([
      Sale.find({ pharmacyId, buyerId: id, voided: { $ne: true } })
        .sort({ timestamp: -1 })
        .limit(HISTORY_LIMIT)
        .select("receiptNumber branchId timestamp totalAmount items.productName items.quantity items.lineTotal")
        .lean(),
      StoreSale.find({ pharmacyId, buyerId: id }).sort({ timestamp: -1 }).limit(HISTORY_LIMIT).lean(),
      Branch.find({ pharmacyId }).select("branchName").lean(),
    ]);
    const branchName = new Map(branches.map((b) => [String(b._id), b.branchName]));

    const purchases = [
      ...sales.map((s) => ({
        id: String(s._id),
        source: "pos" as const,
        date: s.timestamp,
        receiptNumber: s.receiptNumber,
        branch: branchName.get(String(s.branchId)) ?? "",
        total: s.totalAmount,
        items: s.items.map((i) => ({ name: i.productName, quantity: i.quantity, lineTotal: i.lineTotal })),
      })),
      ...storeSales.map((s) => ({
        id: String(s._id),
        source: "store" as const,
        date: s.timestamp,
        receiptNumber: "",
        branch: "Bulk store",
        total: s.totalAmount,
        items: [{ name: s.productName, quantity: s.soldQuantity, lineTotal: s.totalAmount }],
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, HISTORY_LIMIT);

    return NextResponse.json({
      customer: customerJson(buyer),
      purchaseCount: purchases.length,
      totalSpent: purchases.reduce((sum, p) => sum + p.total, 0),
      purchases,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession();
    await dbConnect();
    const { id } = await ctx.params;
    const body = await request.json();
    const { pharmacyId, branchId } = getBranchScope(session, typeof body.branchId === "string" ? body.branchId : null);
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const buyer = await Buyer.findOne({ _id: id, pharmacyId, ...inBranch(branchId) }).lean();
    if (!buyer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const name = typeof body.name === "string" ? body.name.trim() : buyer.name;
    const phoneNumber = typeof body.phoneNumber === "string" ? normalizePhone(body.phoneNumber) : buyer.phoneNumber || "";

    if (!name) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    // Customers saved from the EMR may have no phone; that stays allowed until someone adds one,
    // but a phone that is typed has to be real.
    if (phoneNumber !== (buyer.phoneNumber || "") && phoneNumber.replace(/\D/g, "").length < 7) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    const others = { _id: { $ne: id }, pharmacyId, ...inBranch(branchId) };
    if (phoneNumber) {
      const samePhone = await Buyer.findOne({ ...others, phoneNumber }).lean();
      if (samePhone) {
        return NextResponse.json({ error: `This phone number already belongs to ${samePhone.name}` }, { status: 409 });
      }
    }
    const nameKey = name.toLowerCase();
    const sameName = await Buyer.findOne({ ...others, buyerType: buyer.buyerType, nameKey }).lean();
    if (sameName) {
      return NextResponse.json({ error: `A ${buyer.buyerType} named ${sameName.name} already exists` }, { status: 409 });
    }

    try {
      // Editing a customer who isn't tied to a branch yet pins them to this one.
      const updated = await Buyer.findOneAndUpdate(
        { _id: id, pharmacyId },
        { $set: { name, nameKey, phoneNumber, branchId: buyer.branchId ?? branchId } },
        { new: true }
      ).lean();
      if (!updated) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      return NextResponse.json({ customer: customerJson(updated) });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return NextResponse.json({ error: "A customer with that name already exists" }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
