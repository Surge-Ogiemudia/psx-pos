import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import Buyer from "@/models/Buyer";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { inBranch, createBuyer } from "@/lib/buyerScope";

// Wholesale customers for the POS. Same Buyer records the store side uses, but open to any
// signed-in POS user (/api/buyers is store-staff only). The search also looks in the EMR's
// patient records, so people already saved there don't have to be re-entered; picking one
// saves it as a customer here (POST with emrPatientId).

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
  return { _id: String(b._id), name: b.name, phoneNumber: b.phoneNumber || "", buyerType: b.buyerType, source: "buyer" as const };
}


type EmrPatient = { id: string; name: string; phone: string };

function toEmrPatient(p: { _id: unknown; fullName?: unknown; phoneNumber?: unknown }): EmrPatient | null {
  const name = typeof p.fullName === "string" ? p.fullName.trim() : "";
  if (!name) return null;
  return { id: String(p._id), name, phone: typeof p.phoneNumber === "string" ? normalizePhone(p.phoneNumber) : "" };
}

// The EMR keeps its patients in the same database. If that isn't true on a given
// deployment (collection missing, no access, bad id) this quietly finds nothing, so the
// search still works off saved customers alone.
async function searchEmrPatients(pharmacyId: string, search: string, phoneDigits: string): Promise<EmrPatient[]> {
  try {
    const db = mongoose.connection.db;
    if (!db) return [];
    const or: Record<string, unknown>[] = [{ fullName: { $regex: escapeRegex(search), $options: "i" } }];
    if (phoneDigits.length >= 3) or.push({ phoneNumber: { $regex: escapeRegex(phoneDigits) } });
    const rows = await db
      .collection("patients")
      .find({ pharmacyId: new mongoose.Types.ObjectId(pharmacyId), $or: or })
      .limit(8)
      .toArray();
    return rows.map(toEmrPatient).filter((p): p is EmrPatient => p !== null);
  } catch {
    return [];
  }
}

async function loadEmrPatient(pharmacyId: string, patientId: string): Promise<EmrPatient | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    const row = await db
      .collection("patients")
      .findOne({ _id: new mongoose.Types.ObjectId(patientId), pharmacyId: new mongoose.Types.ObjectId(pharmacyId) });
    return row ? toEmrPatient(row) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    if (search.length < 2) return NextResponse.json({ customers: [] });

    const { pharmacyId, branchId } = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));
    const phoneDigits = normalizePhone(search);

    const or: Record<string, unknown>[] = [{ nameKey: { $regex: escapeRegex(search.toLowerCase()) } }];
    if (phoneDigits.length >= 3) or.push({ phoneNumber: { $regex: escapeRegex(phoneDigits) } });

    const buyers = await Buyer.find({ pharmacyId, $and: [inBranch(branchId), { $or: or }] })
      .sort({ name: 1 })
      .limit(8)
      .lean();
    const patients = await searchEmrPatients(pharmacyId, search, phoneDigits);

    // A patient who is already a saved customer (same phone) is shown once, as the customer.
    const patientPhones = patients.map((p) => p.phone).filter(Boolean);
    const savedByPhone = patientPhones.length
      ? await Buyer.find({ pharmacyId, ...inBranch(branchId), phoneNumber: { $in: patientPhones } }).lean()
      : [];
    const hiddenPhones = new Set([...buyers, ...savedByPhone].map((b) => b.phoneNumber).filter(Boolean));
    const buyerNames = new Set(buyers.map((b) => b.nameKey));

    const emrRows = patients
      .filter((p) => !(p.phone && hiddenPhones.has(p.phone)) && !buyerNames.has(p.name.toLowerCase()))
      .map((p) => ({
        _id: `emr:${p.id}`,
        name: p.name,
        phoneNumber: p.phone,
        buyerType: "wholesaler" as const,
        source: "emr" as const,
        emrPatientId: p.id,
      }));

    return NextResponse.json({ customers: [...buyers.map(toJson), ...emrRows].slice(0, 10) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const body = await request.json();
    const { pharmacyId, branchId } = getBranchScope(session, typeof body.branchId === "string" ? body.branchId : null);

    // Picking an EMR patient: save them as a customer (or reuse the one already saved).
    if (typeof body.emrPatientId === "string" && body.emrPatientId) {
      const patient = await loadEmrPatient(pharmacyId, body.emrPatientId);
      if (!patient) return NextResponse.json({ error: "That EMR record could not be found" }, { status: 404 });

      if (patient.phone) {
        const byPhone = await Buyer.findOne({ pharmacyId, ...inBranch(branchId), phoneNumber: patient.phone }).lean();
        if (byPhone) return NextResponse.json({ customer: toJson(byPhone) });
      }
      const nameKey = patient.name.toLowerCase();
      const byName = await Buyer.findOne({ pharmacyId, ...inBranch(branchId), buyerType: "wholesaler", nameKey }).lean();
      if (byName) return NextResponse.json({ customer: toJson(byName) });

      try {
        const created = await createBuyer({
          pharmacyId,
          branchId,
          name: patient.name,
          nameKey,
          buyerType: "wholesaler",
          phoneNumber: patient.phone,
        });
        return NextResponse.json({ customer: toJson(created) }, { status: 201 });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          const existing = await Buyer.findOne({ pharmacyId, branchId, buyerType: "wholesaler", nameKey }).lean();
          if (existing) return NextResponse.json({ customer: toJson(existing) });
        }
        throw err;
      }
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phoneNumber = typeof body.phoneNumber === "string" ? normalizePhone(body.phoneNumber) : "";
    const buyerType = BUYER_TYPES.includes(body.buyerType) ? (body.buyerType as (typeof BUYER_TYPES)[number]) : "wholesaler";

    if (!name) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    if (phoneNumber.replace(/\D/g, "").length < 7) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    // Same phone already on file → that's the same person; hand them back instead of duplicating.
    const samePhone = await Buyer.findOne({ pharmacyId, ...inBranch(branchId), phoneNumber }).lean();
    if (samePhone) {
      return NextResponse.json(
        { error: `This phone number already belongs to ${samePhone.name}`, existing: toJson(samePhone) },
        { status: 409 }
      );
    }

    const nameKey = name.toLowerCase();
    const sameName = await Buyer.findOne({ pharmacyId, ...inBranch(branchId), buyerType, nameKey }).lean();
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
      const created = await createBuyer({ pharmacyId, branchId, name, nameKey, buyerType, phoneNumber });
      return NextResponse.json({ customer: toJson(created) }, { status: 201 });
    } catch (err) {
      // Lost a race with another till adding the same name — return theirs.
      if ((err as { code?: number }).code === 11000) {
        const existing = await Buyer.findOne({ pharmacyId, branchId, buyerType, nameKey }).lean();
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
