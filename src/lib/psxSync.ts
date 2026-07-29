import { getMainPsxUrl } from "@/lib/mainPsx";
import Pharmacy from "@/models/Pharmacy";

const PSX_SYNC_API_KEY = process.env.PSX_SYNC_API_KEY || "pos-dev-token";

/**
 * Look up the pharmacy slug from the POS Pharmacy model.
 * Returns null if the pharmacy record isn't found (shouldn't happen in normal use).
 */
export async function getPharmacySlug(pharmacyId: string): Promise<string | null> {
  const pharmacy = await Pharmacy.findById(pharmacyId).select("slug").lean();
  return pharmacy?.slug ?? null;
}

interface PosProductForSync {
  _id: unknown; // ObjectId or string
  itemName: string;
  size: string;
  category: string;
  retailPrice: number;
  quantityInStock: number;
  brand: string;
  expiryDate?: Date | null;
}

/**
 * Build the product name that PSX will store.
 * Appends the size unless it is the generic "Standard" placeholder.
 */
function buildPsxName(itemName: string, size: string): string {
  const trimmedSize = (size || "").trim();
  if (!trimmedSize || trimmedSize.toLowerCase() === "standard") {
    return itemName;
  }
  return `${itemName} ${trimmedSize}`;
}

/**
 * Fire-and-forget sync of one or more POS products to the PSX platform.
 * Only medicine-category products are synced.
 *
 * This function never throws — sync failures are logged as warnings so they
 * never block POS operations (the POS is the source of truth; PSX is a mirror).
 */
export async function syncProductsToPsx(
  pharmacySlug: string,
  products: PosProductForSync[]
): Promise<void> {
  // Only sync medicines
  const medicines = products.filter((p) => p.category === "medicine");
  if (medicines.length === 0) return;

  const updates = medicines.map((p) => ({
    posProductId: String(p._id),
    name: buildPsxName(p.itemName, p.size),
    price: p.retailPrice,
    qty: p.quantityInStock,
    manufacturer: p.brand,
    expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
  }));

  try {
    const mainPsxUrl = getMainPsxUrl();
    const res = await fetch(`${mainPsxUrl}/api/pos-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PSX_SYNC_API_KEY}`,
      },
      body: JSON.stringify({
        pharmacy_slug: pharmacySlug,
        updates,
        deletes: [],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`⚠️ PSX sync failed (${res.status}): ${body}`);
    }
  } catch (error) {
    console.warn("⚠️ PSX sync error (non-blocking):", error);
  }
}

/**
 * Notify PSX that one or more POS products have been deleted.
 * Only fires for medicine-category products.
 */
export async function deleteProductsFromPsx(
  pharmacySlug: string,
  products: Array<{ _id: unknown; category: string }>
): Promise<void> {
  const medicines = products.filter((p) => p.category === "medicine");
  if (medicines.length === 0) return;

  const deletes = medicines.map((p) => String(p._id));

  try {
    const mainPsxUrl = getMainPsxUrl();
    const res = await fetch(`${mainPsxUrl}/api/pos-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PSX_SYNC_API_KEY}`,
      },
      body: JSON.stringify({
        pharmacy_slug: pharmacySlug,
        updates: [],
        deletes,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`⚠️ PSX delete-sync failed (${res.status}): ${body}`);
    }
  } catch (error) {
    console.warn("⚠️ PSX delete-sync error (non-blocking):", error);
  }
}

/**
 * Sync only the quantity of specific products (used after sales).
 * Sends a minimal update with just posProductId, qty, and the current price.
 */
export async function syncQtyToPsx(
  pharmacySlug: string,
  products: Array<{
    _id: unknown;
    itemName: string;
    size: string;
    category: string;
    retailPrice: number;
    quantityInStock: number;
    brand: string;
    expiryDate?: Date | null;
  }>
): Promise<void> {
  // Reuse the same sync function — the PSX endpoint uses $set for amount/qty
  // so it will just update those fields without touching enrichment data.
  await syncProductsToPsx(pharmacySlug, products);
}
