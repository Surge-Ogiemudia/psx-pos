// Shared with the "Return Sale" flow: after a sale is voided (Reports/Receipts), its original
// line items are handed off here so POS can pick them back up as a fresh cart on landing. One
// shot — POS clears this the moment it reads it, so it never resurfaces on a later visit.
export interface ResumeItem {
  productId: string | null;
  isCustom: boolean;
  itemName: string | null;
  brand: string | null;
  size: string | null;
  category: string | null;
  quantity: number;
  form: string | null;
  formQuantity: number | null;
  unitPrice: number;
  originalUnitPrice: number | null;
  discountPercent: number;
}

const KEY = "psxPosResumeFromReturn";

export function setPosResume(items: ResumeItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

export function takePosResume(): ResumeItem[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
