import { landingPathFor } from "@/lib/landing";

describe("where each role lands after sign-in", () => {
  it("sends a store keeper with a branch to Point of Sale", () => {
    expect(landingPathFor({ role: "store_keeper", branchId: "b1" })).toBe("/pos");
  });
  it("keeps a store keeper with no branch on the Bulk Store (POS would just bounce them back)", () => {
    expect(landingPathFor({ role: "store_keeper", branchId: null })).toBe("/store");
    expect(landingPathFor({ role: "store_keeper" })).toBe("/store");
    expect(landingPathFor({ role: "store_keeper", branchId: "" })).toBe("/store");
  });
  it("keeps the store manager on the Bulk Store", () => {
    expect(landingPathFor({ role: "store_manager", branchId: "b1" })).toBe("/store");
    expect(landingPathFor({ role: "store_manager", branchId: null })).toBe("/store");
  });
  it("sends admin and staff to Point of Sale, as before", () => {
    expect(landingPathFor({ role: "admin", branchId: null })).toBe("/pos");
    expect(landingPathFor({ role: "admin", branchId: "b1" })).toBe("/pos");
    expect(landingPathFor({ role: "staff", branchId: "b1" })).toBe("/pos");
  });
});
