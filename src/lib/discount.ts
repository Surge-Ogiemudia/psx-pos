// Line discounts are STORED as a percent — that's what the sale API, the sale records, refunds
// and reports all use. The POS lets a cashier enter an amount instead ("₦20 off each unit") and
// these helpers convert in both directions, so nothing downstream has to change.

const PERCENT_DECIMALS = 1e10; // enough that base × qty × rounding error stays far below half a kobo

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ₦ off ONE unit → the percent to store. 0 if there's no usable price or amount. */
export function percentFromAmountOff(basePrice: number, amountOff: number): number {
  if (!(basePrice > 0) || !(amountOff > 0)) return 0;
  const pct = Math.min(100, (amountOff / basePrice) * 100);
  return Math.round(pct * PERCENT_DECIMALS) / PERCENT_DECIMALS;
}

/** A stored percent → ₦ off ONE unit, to the kobo. */
export function amountOffFromPercent(basePrice: number, percent: number | undefined): number {
  if (!(basePrice > 0) || !percent || !(percent > 0)) return 0;
  return round2((basePrice * percent) / 100);
}

/** 20 → "20", 2.5 → "2.50", 1500 → "1,500". */
export function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** 5 → "5", 3.3333333333 → "3.33". */
export function formatPercent(p: number): string {
  return String(Number(p.toFixed(2)));
}

/**
 * How to describe a discounted line to a person: "₦20" when we know the before/after prices
 * (they're saved on every discounted sale line), otherwise the percent.
 */
export function describeDiscount(
  originalUnitPrice: number | null | undefined,
  unitPrice: number,
  percent: number,
  currency: string
): string {
  if (originalUnitPrice != null) {
    const off = round2(originalUnitPrice - unitPrice);
    if (off > 0) return `${currency}${formatAmount(off)}`;
  }
  return `${formatPercent(percent)}%`;
}
