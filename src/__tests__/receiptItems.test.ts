import { sortItemsAlphabetically } from "@/lib/receiptItems";

const line = (productName: string, extra: Record<string, unknown> = {}) => ({ productName, ...extra });

describe("sortItemsAlphabetically (receipt item order)", () => {
  it("sorts A to Z, ignoring case", () => {
    const sorted = sortItemsAlphabetically([line("zolat · 200mg · Emzor"), line("Amoxicillin · 250 · DERM"), line("calamine Lotion · 100ml · SPC")]);
    expect(sorted.map((l) => l.productName)).toEqual(["Amoxicillin · 250 · DERM", "calamine Lotion · 100ml · SPC", "zolat · 200mg · Emzor"]);
  });

  it("puts numbers in numeric order, not text order (5% before 10%)", () => {
    const sorted = sortItemsAlphabetically([line("10% DEXTROSE WATER · 500ml · X"), line("5% DEXTROSE SALINE · 500ml · Y"), line("4.3% DEXTROSE SALINE · 500ml · Z")]);
    expect(sorted.map((l) => l.productName)).toEqual(["4.3% DEXTROSE SALINE · 500ml · Z", "5% DEXTROSE SALINE · 500ml · Y", "10% DEXTROSE WATER · 500ml · X"]);
  });

  it("keeps the same item's sizes together, then orders by size and brand", () => {
    const sorted = sortItemsAlphabetically([
      line("Paracetamol Tablets · 500mg · Emzor"),
      line("Paracetamol Tablets · 500mg · M&B"),
      line("Paracetamol Tablets · 100mg · Emzor"),
      line("Panadol · Standard · GSK"),
    ]);
    expect(sorted.map((l) => l.productName)).toEqual([
      "Panadol · Standard · GSK",
      "Paracetamol Tablets · 100mg · Emzor",
      "Paracetamol Tablets · 500mg · Emzor",
      "Paracetamol Tablets · 500mg · M&B",
    ]);
  });

  it("treats accented letters as their plain letter (Comprimés next to Comprimes)", () => {
    const sorted = sortItemsAlphabetically([line("Zinc"), line("Émile"), line("Apple")]);
    expect(sorted.map((l) => l.productName)).toEqual(["Apple", "Émile", "Zinc"]);
  });

  it("leaves identical names in the order they were rung up", () => {
    const sorted = sortItemsAlphabetically([line("Same", { n: 1 }), line("Same", { n: 2 }), line("Same", { n: 3 })]);
    expect(sorted.map((l) => (l as { n: number }).n)).toEqual([1, 2, 3]);
  });

  it("returns a sorted COPY: the original list is not reordered", () => {
    const original = [line("B"), line("A")];
    const before = JSON.stringify(original);
    const sorted = sortItemsAlphabetically(original);
    expect(sorted).not.toBe(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("handles an empty list and keeps every extra field on each line", () => {
    expect(sortItemsAlphabetically([])).toEqual([]);
    const sorted = sortItemsAlphabetically([line("B", { quantity: 2, lineTotal: 40 }), line("A", { quantity: 1, lineTotal: 10 })]);
    expect(sorted).toEqual([line("A", { quantity: 1, lineTotal: 10 }), line("B", { quantity: 2, lineTotal: 40 })]);
  });
});
