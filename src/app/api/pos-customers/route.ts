import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import { requireApiSession } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";

// Wholesale customers for the POS. Same Buyer records the store side uses, but open to any
// signed-in POS user (/api/buyers is store-staff only).

const BUYER_TYPES = ["distributor", "wholesaler", "retailer"] as const;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Phones are compared as typed minus spaces/dashes/brackets, so "0803 123 4567" and
// "0803-123-4567" are the same number.
function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

function toJson(b: { _id: unknown; name: string; phoneNumber?: string | null; buyerType: string }) {
  return { _id: String(b._id), name: b.name, phoneNumber: b.phoneNumber || "", buyerType: b.buyerType };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    if (search.length < 2) return NextResponse.json({ customers: [] });

    const or: Record<string, unknown>[] = [{ nameKey: { $regex: escapeRegex(search.toLowerCase()) } }];
    const phoneDigits = normalizePhone(search);
    if (phoneDigits.length >= 3) or.push({ phoneNumber: { $regex: escapeRegex(phoneDigits) } });

    const customers = await Buyer.find({ pharmacyId: session.user.pharmacyId, $or: or })
      .sort({ name: 1 })
      .limit(8)
      .lean();
    return NextResponse.json({ customers: customers.map(toJson) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phoneNumber = typeof body.phoneNumber === "string" ? normalizePhone(body.phoneNumber) : "";
    const buyerType = BUYER_TYPES.includes(body.buyerType) ? (body.buyerType as (typeof BUYER_TYPES)[number]) : "wholesaler";

    if (!name) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    if (phoneNumber.replace(/\D/g, "").length < 7) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    const pharmacyId = session.user.pharmacyId;

    // Same phone already on file → that's the same person; hand them back instead of duplicating.
    const samePhone = await Buyer.findOne({ pharmacyId, phoneNumber }).lean();
    if (samePhone) {
      return NextResponse.json(
        { error: `This phone number already belongs to ${samePhone.name}`, existing: toJson(samePhone) },
        { status: 409 }
      );
    }

    const nameKey = name.toLowerCase();
    const sameName = await Buyer.findOne({ pharmacyId, buyerType, nameKey }).lean();
    if (sameName) {
      return NextResponse.json(
        {
          error: `A ${buyerType} named ${sameName.name} already exists${sameName.phoneNumber ? ` (${sameName.phoneNumber})` : ""}`,
          existing: toJson(sameName),
        },
        { status: 409 }
      );
    }

    try {
      const created = await Buyer.create({ pharmacyId, name, nameKey, buyerType, phoneNumber });
      return NextResponse.json({ customer: toJson(created) }, { status: 201 });
    } catch (err) {
      // Lost a race with another till adding the same name — return theirs.
      if ((err as { code?: number }).code === 11000) {
        const existing = await Buyer.findOne({ pharmacyId, buyerType, nameKey }).lean();
        if (existing) {
          return NextResponse.json({ error: `${existing.name} already exists`, existing: toJson(existing) }, { status: 409 });
        }
      }
      throw err;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
