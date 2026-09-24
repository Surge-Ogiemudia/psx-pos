// Receipt paper width is a per-device choice (each till has its own printer), kept in localStorage.
// Default 58mm so existing pharmacies are unaffected; 80mm is for printers like the Xprinter XP-80.
export type ReceiptPaper = "58" | "80";

const KEY = "psxReceiptPaper";
const EVENT = "psx-receipt-paper";

export function getReceiptPaper(): ReceiptPaper {
  try {
    return localStorage.getItem(KEY) === "80" ? "80" : "58";
  } catch {
    return "58";
  }
}

export function setReceiptPaper(p: ReceiptPaper) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onReceiptPaperChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
