import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import Product from "@/models/Product";
import { requireApiSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await requireApiSession();
    if (!session?.user?.pharmacyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");

    await dbConnect();

    const baseQuery: any = { pharmacyId: session.user.pharmacyId };
    if (branchId) baseQuery.branchId = branchId;

    // Fetch all drafts for this pharmacy/branch
    const allDrafts = await AiDraftProduct.find(baseQuery).sort({ createdAt: -1 }).lean();

    const pendingCount = allDrafts.filter(d => d.status === "pending").length;
    const processingCount = allDrafts.filter(d => d.status === "processing").length;
    const completedCount = allDrafts.filter(d => d.status === "completed").length;
    const errorCount = allDrafts.filter(d => d.status === "error").length;

    // Filter to drafts that are in 'extracted' state (ready for audit)
    const extractedDrafts = allDrafts.filter(d => d.status === "extracted");

    // 1. Group Duplicates
    // We group by barcode (if barcode has at least 6 chars) OR by normalized name + size
    const duplicateMap = new Map<string, any[]>();

    extractedDrafts.forEach(draft => {
      // If marked as split or uniquely separated by reviewer, do not group as duplicate
      if (draft.isSplitUnique) return;

      const barcode = (draft.extractedBarcode || "").trim();
      const normName = (draft.extractedItemName || "").trim().toLowerCase();
      const normSize = (draft.extractedSize || "").trim().toLowerCase();

      let groupKey = "";
      if (barcode.length >= 6) {
        groupKey = `bc_${barcode}`;
      } else if (normName && !normName.includes("unnamed") && normName.length >= 3) {
        groupKey = `name_${normName}_${normSize}`;
      }

      if (groupKey) {
        if (!duplicateMap.has(groupKey)) {
          duplicateMap.set(groupKey, []);
        }
        duplicateMap.get(groupKey)!.push(draft);
      }
    });

    const duplicateGroups: any[] = [];
    const duplicateDraftIds = new Set<string>();

    duplicateMap.forEach((items, key) => {
      if (items.length > 1) {
        items.forEach(it => duplicateDraftIds.add(String(it._id)));
        
        // Sum total quantity across duplicates
        const totalQty = items.reduce((acc, it) => acc + (it.quantityInStock || 0), 0);
        // Find highest or first non-zero price
        const bestPrice = items.find(it => it.retailPrice && it.retailPrice > 0)?.retailPrice || 0;
        const bestBarcode = items.find(it => it.extractedBarcode && it.extractedBarcode.trim())?.extractedBarcode || "";

        duplicateGroups.push({
          groupKey: key,
          count: items.length,
          totalQty,
          suggestedPrice: bestPrice,
          suggestedBarcode: bestBarcode,
          items,
        });
      }
    });

function computeReviewFlags(draft: any): string[] {
  const flags = new Set<string>(draft.needsReviewReason || []);
  const name = (draft.extractedItemName || "").toLowerCase();
  const brand = (draft.extractedBrand || "").toLowerCase();
  const size = (draft.extractedSize || "").toLowerCase();
  const price = Number(draft.retailPrice || 0);
  const qty = Number(draft.quantityInStock || 0);
  const cat = draft.category || "medicine";
  const fullName = `${name} ${brand} ${size}`;

  // 1. Price checks
  if (price <= 0) flags.add("zero_price");
  else if (price < 50) flags.add("unlikely_low_price");
  else if (price > 50000) flags.add("high_price_check");

  // 2. Quantity checks
  if (qty <= 0) flags.add("zero_qty");
  else if (qty > 100) flags.add("high_qty_check");

  // 3. Name checks
  if (!name || name.includes("unnamed") || name.length < 3) flags.add("missing_name");

  // 4. Expiry checks
  if (draft.extractedExpiryDate) {
    const exp = new Date(draft.extractedExpiryDate);
    const now = new Date();
    if (exp < now) flags.add("past_expiry");
    const year = exp.getFullYear();
    if (year > 2040 || year < 2020) flags.add("unlikely_expiry_year");
  } else if (cat === "medicine") {
    flags.add("missing_expiry");
  }

  // 5. Category mismatch check
  const pharmaKeywords = ["mg", "tablet", "tablets", "capsule", "capsules", "syrup", "suspension", "injection", "infusion", "ointment", "antibiotic", "paracetamol", "amoxicillin", "ampicillin", "metronidazole", "artemether", "lumefantrine", "ciprofloxacin", "ibuprofen", "diclofenac", "inhaler", "suppository"];
  const supermarketKeywords = ["biscuit", "biscuits", "wafer", "wafers", "drink", "drinks", "coca cola", "fanta", "sprite", "pepsi", "malt", "water", "detergent", "bleach", "soap", "toothpaste", "toilet roll", "tissue", "sponge", "cleaner", "deodorant", "perfume", "diaper", "diapers", "milk", "tea", "coffee", "sugar"];

  const hasPharma = pharmaKeywords.some(k => fullName.includes(k));
  const hasSuper = supermarketKeywords.some(k => fullName.includes(k));

  if (cat !== "medicine" && hasPharma) {
    flags.add("looks_like_medicine");
  } else if (cat === "medicine" && hasSuper && !hasPharma) {
    flags.add("looks_like_supermarket");
  }

  return Array.from(flags);
}

    // 2. Filter Needs Attention (evaluating all anomaly flags)
    const needsAttentionDrafts = extractedDrafts.filter(draft => {
      if (duplicateDraftIds.has(String(draft._id))) return false;
      const flags = computeReviewFlags(draft);
      draft.needsReviewReason = flags;
      return flags.length > 0;
    });

    // 3. Ready to Publish (Clean items not in duplicate groups and not needing attention)
    const needsAttentionIds = new Set(needsAttentionDrafts.map(d => String(d._id)));
    const readyToPublishDrafts = extractedDrafts.filter(draft => {
      const idStr = String(draft._id);
      if (duplicateDraftIds.has(idStr)) return false;
      if (needsAttentionIds.has(idStr)) return false;
      const hasValidPrice = draft.retailPrice && draft.retailPrice > 0;
      const hasValidName = draft.extractedItemName && !draft.extractedItemName.toLowerCase().includes("unnamed") && draft.extractedItemName.length >= 3;
      return hasValidPrice && hasValidName;
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalDrafts: allDrafts.length,
        pending: pendingCount,
        processing: processingCount,
        extracted: extractedDrafts.length,
        completed: completedCount,
        error: errorCount,
        duplicateGroupsCount: duplicateGroups.length,
        duplicateDraftsCount: duplicateDraftIds.size,
        needsAttentionCount: needsAttentionDrafts.length,
        readyToPublishCount: readyToPublishDrafts.length,
      },
      duplicateGroups,
      needsAttention: needsAttentionDrafts,
      readyToPublish: readyToPublishDrafts,
    });
  } catch (error: any) {
    console.error("Failed to fetch resolve queue:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch resolve queue" }, { status: 500 });
  }
}
