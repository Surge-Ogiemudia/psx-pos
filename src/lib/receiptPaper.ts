// Receipt paper is a per-device choice (each till has its own printer), kept in localStorage.
// Default 58mm so existing pharmacies are unaffected; 80mm is for printers like the Xprinter
// XP-80; "A4" is a plain fallback for a till whose thermal printer won't cooperate — prints the
// same receipt on a normal office printer, normal page, normal page breaks if it runs long
// (unlike thermal roll paper, a fixed A4 sheet can't be stretched to fit a long receipt on one
// page, so a big wholesale cart is expected to run to a second/third A4 page there).
export type ReceiptPaper = "58" | "80" | "A4";

const KEY = "psxReceiptPaper";
const EVENT = "psx-receipt-paper";

export function getReceiptPaper(): ReceiptPaper {
  try {
    const v = localStorage.getItem(KEY);
    return v === "80" || v === "A4" ? v : "58";
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

// Long-receipt mode: for very long carts (wholesale, 100-200+ lines), some browsers'
// "size: <w>mm auto" print pipeline silently splits one long receipt into several print jobs
// (header / body / footer land on separate pieces of paper). Using a large fixed page height
// instead of auto avoids that on the printers we've seen it on. Off by default and per-device
// (localStorage), so turning it on on one wholesale till never affects any other till or
// pharmacy — everyone else keeps the existing "auto" behavior untouched.
const LONG_KEY = "psxReceiptLongMode";
const LONG_EVENT = "psx-receipt-long-mode";

export function getReceiptLongMode(): boolean {
  try {
    return localStorage.getItem(LONG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReceiptLongMode(on: boolean) {
  try {
    localStorage.setItem(LONG_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(LONG_EVENT));
}

export function onReceiptLongModeChange(cb: () => void) {
  window.addEventListener(LONG_EVENT, cb);
  return () => window.removeEventListener(LONG_EVENT, cb);
}
