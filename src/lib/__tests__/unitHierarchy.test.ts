import {
  parseHierarchyString,
  computeBaseUnitsPerLevel,
  convertToBaseUnits,
  compareBatchesFifo,
  planDraw,
  planBestEffortDraw,
  describeBreakdown,
  pluralize,
} from "@/lib/unitHierarchy";

describe("parseHierarchyString", () => {
  it("parses a compact hierarchy string largest to smallest", () => {
    expect(parseHierarchyString("carton:1>box:4>piece:10")).toEqual([
      { unitName: "carton", unitsPerParent: 1 },
      { unitName: "box", unitsPerParent: 4 },
      { unitName: "piece", unitsPerParent: 10 },
    ]);
  });

  it("forces the root level's unitsPerParent to 1 regardless of input", () => {
    const [root] = parseHierarchyString("carton:99>piece:10")!;
    expect(root.unitsPerParent).toBe(1);
  });

  it("returns null for empty/missing input", () => {
    expect(parseHierarchyString(undefined)).toBeNull();
    expect(parseHierarchyString("")).toBeNull();
    expect(parseHierarchyString("   ")).toBeNull();
  });
});

describe("computeBaseUnitsPerLevel", () => {
  it("computes how many base units make up each level", () => {
    const hierarchy = parseHierarchyString("carton:1>box:4>piece:10")!;
    expect(computeBaseUnitsPerLevel(hierarchy)).toEqual({
      carton: 40, // 4 boxes * 10 pieces
      box: 10,
      piece: 1,
    });
  });

  it("treats a single-level hierarchy as 1 base unit", () => {
    const hierarchy = parseHierarchyString("piece:1")!;
    expect(computeBaseUnitsPerLevel(hierarchy)).toEqual({ piece: 1 });
  });
});

describe("convertToBaseUnits", () => {
  const hierarchy = parseHierarchyString("carton:1>box:4>piece:10")!;

  it("converts a quantity in a given form to base units", () => {
    expect(convertToBaseUnits(hierarchy, "carton", 2)).toBe(80);
    expect(convertToBaseUnits(hierarchy, "box", 3)).toBe(30);
    expect(convertToBaseUnits(hierarchy, "piece", 5)).toBe(5);
  });

  it("throws when the form isn't defined on the hierarchy", () => {
    expect(() => convertToBaseUnits(hierarchy, "pallet", 1)).toThrow();
  });
});

describe("compareBatchesFifo", () => {
  it("sorts soonest expiry first", () => {
    const batches = [
      { id: "a", expiryDate: "2027-06-01", receivedAt: "2026-01-01" },
      { id: "b", expiryDate: "2026-06-01", receivedAt: "2026-01-01" },
    ];
    expect([...batches].sort(compareBatchesFifo).map((b) => b.id)).toEqual(["b", "a"]);
  });

  it("puts batches with no expiry after batches with an expiry", () => {
    const batches = [
      { id: "no-expiry", expiryDate: null, receivedAt: "2020-01-01" },
      { id: "has-expiry", expiryDate: "2099-01-01", receivedAt: "2026-01-01" },
    ];
    expect([...batches].sort(compareBatchesFifo).map((b) => b.id)).toEqual(["has-expiry", "no-expiry"]);
  });

  it("tie-breaks equal expiry by oldest received first", () => {
    const batches = [
      { id: "newer", expiryDate: "2099-01-01", receivedAt: "2026-06-01" },
      { id: "older", expiryDate: "2099-01-01", receivedAt: "2026-01-01" },
    ];
    expect([...batches].sort(compareBatchesFifo).map((b) => b.id)).toEqual(["older", "newer"]);
  });
});

describe("planDraw", () => {
  it("draws from a single batch when it has enough", () => {
    const batches = [{ id: "a", remainingBaseUnitQuantity: 10 }];
    expect(planDraw(batches, 4)).toEqual([{ id: "a", baseUnitsDrawn: 4 }]);
  });

  it("spans multiple batches in FIFO order when the first isn't enough", () => {
    const batches = [
      { id: "a", remainingBaseUnitQuantity: 3 },
      { id: "b", remainingBaseUnitQuantity: 10 },
    ];
    expect(planDraw(batches, 5)).toEqual([
      { id: "a", baseUnitsDrawn: 3 },
      { id: "b", baseUnitsDrawn: 2 },
    ]);
  });

  it("skips empty batches", () => {
    const batches = [
      { id: "empty", remainingBaseUnitQuantity: 0 },
      { id: "b", remainingBaseUnitQuantity: 10 },
    ];
    expect(planDraw(batches, 5)).toEqual([{ id: "b", baseUnitsDrawn: 5 }]);
  });

  it("returns null when total stock across all batches is insufficient", () => {
    const batches = [{ id: "a", remainingBaseUnitQuantity: 2 }];
    expect(planDraw(batches, 5)).toBeNull();
  });
});

describe("planBestEffortDraw", () => {
  it("draws as much as available instead of failing when stock is short", () => {
    const batches = [{ id: "a", remainingBaseUnitQuantity: 2 }];
    expect(planBestEffortDraw(batches, 5)).toEqual([{ id: "a", baseUnitsDrawn: 2 }]);
  });

  it("returns an empty plan when nothing is available", () => {
    expect(planBestEffortDraw([], 5)).toEqual([]);
  });
});

describe("describeBreakdown", () => {
  it("breaks a sold form+quantity down across every hierarchy level", () => {
    const hierarchy = parseHierarchyString("carton:1>box:4>piece:10")!;
    const result = describeBreakdown(hierarchy, "box", 2, 200);
    expect(result.baseUnitQuantity).toBe(20); // 2 boxes * 10 pieces
    expect(result.baseUnitName).toBe("piece");
    const piece = result.levels.find((l) => l.unitName === "piece")!;
    expect(piece.quantity).toBe(20);
    expect(piece.amountPerUnit).toBeCloseTo(10); // 200 / 20 pieces
  });
});

describe("pluralize", () => {
  it("leaves singular quantities alone", () => {
    expect(pluralize("box", 1)).toBe("box");
  });

  it("adds -s for a plain plural", () => {
    expect(pluralize("carton", 2)).toBe("cartons");
  });

  it("adds -es for words ending in a sibilant", () => {
    expect(pluralize("box", 3)).toBe("boxes");
  });
});
