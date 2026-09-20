// Which price tier this POS session sells at — retail or wholesale. Deliberately asked
// fresh every login (sessionStorage, not localStorage) rather than locked to a specific
// computer: if a machine ever gets physically swapped between counters, a stale
// per-device setting would silently charge the wrong price with no one noticing.
// Asking at login instead means whoever's using the machine today makes the call today.
export const POS_SALE_MODE_KEY = "psx_pos_sale_mode";
export type PosSaleMode = "retail" | "wholesale";

export function clearPosSaleMode() {
  try {
    sessionStorage.removeItem(POS_SALE_MODE_KEY);
  } catch {
    // sessionStorage can throw in a locked-down browser context — never block sign-out over it.
  }
}
