import {
  amountOffFromPercent,
  describeDiscount,
  formatAmount,
  formatPercent,
  percentFromAmountOff,
  round2,
} from "@/lib/discount";

// The price the sale API ends up with for one unit / a catalog line: same formulas as
// src/app/api/sales/route.ts, step for step.
const serverUnitPrice = (base: number, pct: number) => round2(base * (1 - pct / 100));
const serverLineTotal = (base: number, qty: number, pct: number) => round2(round2(base * qty) * (1 - pct / 100));

describe("entering a ₦ discount lands on exactly that ₦", () => {
  it("₦20 off ₦600 gives ₦580 — the case the % stepper could never hit", () => {
    const pct = percentFromAmountOff(600, 20);
    expect(pct).toBeCloseTo(3.3333333333, 8);
    expect(serverUnitPrice(600, pct)).toBe(580);
  });

  it("is exact across many prices, amounts and quantities (unit price AND line total)", () => {
    const bases = [1, 7.5, 50, 99.99, 150, 600, 1234.56, 5000, 25000, 99999.99];
    const amounts = [0.5, 1, 5, 10, 20, 35, 50, 100, 250];
    const qtys = [1, 2, 3, 12, 100, 999];
    let checked = 0;
    for (const base of bases) {
      for (const amt of amounts) {
        if (amt >= base) continue;
        const pct = percentFromAmountOff(base, amt);
        expect(serverUnitPrice(base, pct)).toBe(round2(base - amt));
        for (const q of qtys) {
          expect(serverLineTotal(base, q, pct)).toBe(round2(round2(base * q) - amt * q));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("never exceeds 100% and ignores nonsense", () => {
    expect(percentFromAmountOff(100, 500)).toBe(100);
    expect(percentFromAmountOff(0, 20)).toBe(0);
    expect(percentFromAmountOff(600, 0)).toBe(0);
    expect(percentFromAmountOff(600, -5)).toBe(0);
    expect(percentFromAmountOff(NaN, 20)).toBe(0);
  });
});

describe("showing a stored percent back as ₦", () => {
  it("round-trips: ₦20 → percent → ₦20", () => {
    for (const [base, amt] of [[600, 20], [1234.56, 35], [50, 2.5], [99999.99, 250]] as const) {
      expect(amountOffFromPercent(base, percentFromAmountOff(base, amt))).toBe(amt);
    }
  });
  it("a whole-number percent gives the matching ₦ (5% of ₦50 = ₦2.50)", () => {
    expect(amountOffFromPercent(50, 5)).toBe(2.5);
  });
  it("no discount → 0", () => {
    expect(amountOffFromPercent(600, undefined)).toBe(0);
    expect(amountOffFromPercent(600, 0)).toBe(0);
  });
});

describe("wording", () => {
  it("formats amounts and percents tidily", () => {
    expect(formatAmount(20)).toBe("20");
    expect(formatAmount(2.5)).toBe("2.50");
    expect(formatAmount(1500)).toBe("1,500");
    expect(formatPercent(5)).toBe("5");
    expect(formatPercent(3.3333333333)).toBe("3.33");
  });
  it("describes a discount in ₦ when the before/after prices are known, else in %", () => {
    expect(describeDiscount(600, 580, 3.3333333333, "₦")).toBe("₦20");
    expect(describeDiscount(50, 47.5, 5, "N")).toBe("N2.50");
    expect(describeDiscount(null, 47.5, 5, "₦")).toBe("5%");
    expect(describeDiscount(undefined, 47.5, 3.3333333333, "₦")).toBe("3.33%");
  });
});
