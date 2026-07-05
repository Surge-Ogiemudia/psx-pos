export type ExpiryLevel = "none" | "warning" | "urgent" | "expired";

export interface ExpiryStatus {
  level: ExpiryLevel;
  daysRemaining: number | null;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Alerting starts 3 months out (matches how most pharmacies plan stock rotation):
 * >90 days or no expiry at all -> "none" (no alert)
 * 31-90 days -> "warning" (plenty of time, but worth planning around)
 * 0-30 days -> "urgent" (needs active attention — discount, return to supplier, etc.)
 * past the date -> "expired" (should not be sold)
 */
export function getExpiryStatus(expiryDate: string | Date | null | undefined, now: Date = new Date()): ExpiryStatus {
  if (!expiryDate) return { level: "none", daysRemaining: null, label: "" };

  const expiry = new Date(expiryDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const daysRemaining = Math.round((expiryDay.getTime() - today.getTime()) / DAY_MS);

  if (daysRemaining < 0) return { level: "expired", daysRemaining, label: `Expired ${Math.abs(daysRemaining)}d ago` };
  if (daysRemaining === 0) return { level: "expired", daysRemaining, label: "Expires today" };
  if (daysRemaining <= 30) return { level: "urgent", daysRemaining, label: `${daysRemaining}d to expiry` };
  if (daysRemaining <= 90) return { level: "warning", daysRemaining, label: `${daysRemaining}d to expiry` };
  return { level: "none", daysRemaining, label: "" };
}

export const EXPIRY_ROW_CLASS: Record<ExpiryLevel, string> = {
  none: "",
  warning: "bg-amber-50",
  urgent: "bg-orange-50",
  expired: "bg-red-50",
};

export const EXPIRY_BADGE_CLASS: Record<ExpiryLevel, string> = {
  none: "",
  warning: "bg-amber-100 text-amber-800 border border-amber-300",
  urgent: "bg-orange-100 text-orange-800 border border-orange-400",
  expired: "bg-red-100 text-red-800 border border-red-400",
};

export const EXPIRY_TEXT_CLASS: Record<ExpiryLevel, string> = {
  none: "text-zinc-600",
  warning: "text-amber-700 font-medium",
  urgent: "text-orange-700 font-semibold",
  expired: "text-red-700 font-semibold",
};
