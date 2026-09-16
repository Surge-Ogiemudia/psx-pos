export function computeReviewFlags(draft: {
  extractedItemName?: string | null;
  extractedBrand?: string | null;
  extractedSize?: string | null;
  retailPrice?: number | null;
  quantityInStock?: number | null;
  category?: string | null;
  extractedExpiryDate?: Date | string | null;
  needsReviewReason?: string[] | null;
  categoryConfirmed?: boolean | null;
}): string[] {
  const flags = new Set<string>();
  const name = (draft.extractedItemName || "").toLowerCase().trim();
  const brand = (draft.extractedBrand || "").toLowerCase().trim();
  const size = (draft.extractedSize || "").toLowerCase().trim();
  const price = draft.retailPrice !== undefined && draft.retailPrice !== null ? Number(draft.retailPrice) : 0;
  const qty = draft.quantityInStock !== undefined && draft.quantityInStock !== null ? Number(draft.quantityInStock) : 0;
  const cat = draft.category || "medicine";
  const fullName = `${name} ${brand} ${size}`;

  // 1. Price checks
  if (price <= 0) {
    flags.add("zero_price");
  } else if (price < 50) {
    flags.add("unlikely_low_price");
  } else if (price > 50000) {
    flags.add("high_price_check");
  }

  // 2. Quantity checks
  if (qty <= 0) {
    flags.add("zero_qty");
  } else if (qty > 100) {
    flags.add("high_qty_check");
  }

  // 3. Name checks
  if (!name || name.includes("unnamed") || name.length < 3) {
    flags.add("missing_name");
  }

  // 4. Expiry checks
  if (draft.extractedExpiryDate) {
    const exp = new Date(draft.extractedExpiryDate);
    if (!isNaN(exp.getTime())) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (exp < today) {
        flags.add("past_expiry");
      }
      const year = exp.getFullYear();
      if (year > 2040 || year < 2020) {
        flags.add("unlikely_expiry_year");
      }
    } else if (cat === "medicine") {
      flags.add("missing_expiry");
    }
  } else if (cat === "medicine") {
    flags.add("missing_expiry");
  }

  // 5. Category mismatch check (bypassed if human reviewer explicitly confirmed the category)
  if (!draft.categoryConfirmed) {
    const pharmaKeywords = [
      "mg", "tablet", "tablets", "capsule", "capsules", "syrup", "suspension",
      "injection", "infusion", "ointment", "antibiotic", "paracetamol", "amoxicillin",
      "ampicillin", "metronidazole", "artemether", "lumefantrine", "ciprofloxacin",
      "ibuprofen", "diclofenac", "inhaler", "suppository", "cream", "gel", "lotion",
      "drops", "elixir", "powder", "bandage", "gauze", "cotton", "plaster"
    ];
    const supermarketKeywords = [
      "biscuit", "biscuits", "wafer", "wafers", "drink", "drinks", "coca cola",
      "fanta", "sprite", "pepsi", "malt", "water", "detergent", "bleach", "soap",
      "toothpaste", "toilet roll", "tissue", "cleaner", "deodorant",
      "perfume", "diaper", "diapers", "milk", "tea", "coffee", "sugar", "condom", "condoms"
    ];

    const hasPharma = pharmaKeywords.some(k => fullName.includes(k));
    const hasSuper = supermarketKeywords.some(k => fullName.includes(k));

    if (cat !== "medicine" && hasPharma) {
      flags.add("looks_like_medicine");
    } else if (cat === "medicine" && hasSuper && !hasPharma) {
      flags.add("looks_like_supermarket");
    }
  }

  return Array.from(flags);
}
