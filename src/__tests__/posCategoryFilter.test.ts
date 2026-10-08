import { filterByCategory, isPosCategoryFilter, POS_CATEGORY_OPTIONS } from "@/lib/posCategoryFilter";

const products = [
  { _id: "1", itemName: "Paracetamol", category: "medicine" as const },
  { _id: "2", itemName: "Indomie", category: "supermarket" as const },
  { _id: "3", itemName: "Cotton wool", category: "non-medicine" as const },
  { _id: "4", itemName: "Amoxicillin", category: "medicine" as const },
  { _id: "5", itemName: "Legacy item with no category", category: null },
];

describe("filterByCategory (the POS category view switch)", () => {
  it("shows everything on All, including items with no category", () => {
    expect(filterByCategory(products, "all")).toHaveLength(5);
  });

  it("narrows to one category", () => {
    expect(filterByCategory(products, "medicine").map((p) => p._id)).toEqual(["1", "4"]);
    expect(filterByCategory(products, "supermarket").map((p) => p._id)).toEqual(["2"]);
    expect(filterByCategory(products, "non-medicine").map((p) => p._id)).toEqual(["3"]);
  });

  it("is view-only: the original list is not changed", () => {
    const before = JSON.stringify(products);
    filterByCategory(products, "medicine");
    expect(JSON.stringify(products)).toBe(before);
  });

  it("can come back empty without error", () => {
    expect(filterByCategory([{ category: "medicine" as const }], "supermarket")).toEqual([]);
  });
});

describe("isPosCategoryFilter (reading the remembered choice)", () => {
  it("accepts every option the switch offers", () => {
    for (const o of POS_CATEGORY_OPTIONS) expect(isPosCategoryFilter(o.value)).toBe(true);
  });
  it("rejects anything else, so a stale or tampered saved value falls back to All", () => {
    expect(isPosCategoryFilter("drinks")).toBe(false);
    expect(isPosCategoryFilter(null)).toBe(false);
    expect(isPosCategoryFilter(undefined)).toBe(false);
  });
});
