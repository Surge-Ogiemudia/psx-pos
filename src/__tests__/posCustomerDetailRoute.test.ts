import { NextRequest } from "next/server";

jest.mock("@/lib/mongodb", () => ({ dbConnect: jest.fn() }));
jest.mock("@/lib/session", () => ({
  requireApiSession: jest.fn(async () => ({ user: { pharmacyId: "pharmacy-1", branchId: "branch-1", role: "staff" } })),
  getBranchScope: jest.fn(() => ({ pharmacyId: "pharmacy-1", branchId: "branch-1" })),
}));
jest.mock("mongoose", () => ({
  __esModule: true,
  default: { isValidObjectId: (v: string) => /^[a-f0-9]{24}$/.test(v) },
}));

const buyerFindOne = jest.fn();
const buyerUpdate = jest.fn();
jest.mock("@/models/Buyer", () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => buyerFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => buyerUpdate(...a),
  },
}));
const saleFind = jest.fn();
jest.mock("@/models/Sale", () => ({ __esModule: true, default: { find: (...a: unknown[]) => saleFind(...a) } }));
const storeSaleFind = jest.fn();
jest.mock("@/models/StoreSale", () => ({ __esModule: true, default: { find: (...a: unknown[]) => storeSaleFind(...a) } }));
const branchFind = jest.fn();
jest.mock("@/models/Branch", () => ({ __esModule: true, default: { find: (...a: unknown[]) => branchFind(...a) } }));

import { GET, PATCH } from "@/app/api/pos-customers/[id]/route";

const ID = "a".repeat(24);
const leanOf = (v: unknown) => ({ lean: async () => v });
const listOf = (v: unknown[]) => {
  const c: Record<string, jest.Mock> = {};
  c.sort = jest.fn(() => c);
  c.limit = jest.fn(() => c);
  c.select = jest.fn(() => c);
  c.lean = jest.fn(async () => v);
  return c;
};
const ctx = { params: Promise.resolve({ id: ID }) };
const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/pos-customers/x", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    ctx
  );

const buyer = { _id: ID, name: "Mama Chidi", phoneNumber: "08031234567", buyerType: "wholesaler", branchId: null };

beforeEach(() => jest.clearAllMocks());

describe("GET /api/pos-customers/[id]", () => {
  it("404s for a customer outside this branch's reach", async () => {
    buyerFindOne.mockReturnValue(leanOf(null));
    const res = await GET(new NextRequest("http://localhost/api/pos-customers/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns the customer with POS and store purchases merged, newest first", async () => {
    buyerFindOne.mockReturnValue(leanOf(buyer));
    saleFind.mockReturnValue(
      listOf([
        {
          _id: "s1",
          receiptNumber: "20260101-001",
          branchId: "branch-1",
          timestamp: new Date("2026-01-01"),
          totalAmount: 500,
          items: [{ productName: "Paracetamol · 500mg · Emzor", quantity: 2, lineTotal: 500 }],
        },
      ])
    );
    storeSaleFind.mockReturnValue(
      listOf([{ _id: "t1", timestamp: new Date("2026-02-01"), totalAmount: 9000, productName: "Amoxil", soldQuantity: 3 }])
    );
    branchFind.mockReturnValue(listOf([{ _id: "branch-1", branchName: "Main" }]));

    const body = await (await GET(new NextRequest("http://localhost/api/pos-customers/x"), ctx)).json();
    expect(body.purchases.map((p: { source: string }) => p.source)).toEqual(["store", "pos"]);
    expect(body.purchases[1].branch).toBe("Main");
    expect(body.totalSpent).toBe(9500);
    expect(body.purchaseCount).toBe(2);
    // returned (voided) sales are left out
    expect(saleFind.mock.calls[0][0]).toMatchObject({ buyerId: ID, voided: { $ne: true } });
  });

  it("shows zero purchases for a customer with no linked sales", async () => {
    buyerFindOne.mockReturnValue(leanOf(buyer));
    saleFind.mockReturnValue(listOf([]));
    storeSaleFind.mockReturnValue(listOf([]));
    branchFind.mockReturnValue(listOf([]));
    const body = await (await GET(new NextRequest("http://localhost/api/pos-customers/x"), ctx)).json();
    expect(body.purchaseCount).toBe(0);
    expect(body.totalSpent).toBe(0);
  });
});

describe("PATCH /api/pos-customers/[id]", () => {
  it("rejects an empty name", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf(buyer));
    expect((await patch({ name: "  " })).status).toBe(400);
  });

  it("rejects a changed phone that isn't a real number", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf(buyer));
    expect((await patch({ phoneNumber: "123" })).status).toBe(400);
    expect(buyerUpdate).not.toHaveBeenCalled();
  });

  it("refuses a phone that belongs to another customer", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf(buyer)).mockReturnValueOnce(leanOf({ name: "Chidi Pharmacy" }));
    const res = await patch({ phoneNumber: "0803 999 9999" });
    expect(res.status).toBe(409);
    expect(buyerUpdate).not.toHaveBeenCalled();
  });

  it("refuses a name another customer of that type already has", async () => {
    buyerFindOne
      .mockReturnValueOnce(leanOf(buyer))
      .mockReturnValueOnce(leanOf(null)) // phone free
      .mockReturnValueOnce(leanOf({ name: "Chidi Pharmacy" }));
    expect((await patch({ name: "chidi pharmacy", phoneNumber: "08039999999" })).status).toBe(409);
  });

  it("saves the edit, cleaning the phone, and pins an unpinned customer to this branch", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf(buyer)).mockReturnValue(leanOf(null));
    buyerUpdate.mockReturnValue(leanOf({ ...buyer, name: "Mama Chidi Stores", phoneNumber: "08039999999", branchId: "branch-1" }));
    const res = await patch({ name: " Mama Chidi Stores ", phoneNumber: "0803-999-9999" });
    expect(res.status).toBe(200);
    expect(buyerUpdate.mock.calls[0][1]).toEqual({
      $set: { name: "Mama Chidi Stores", nameKey: "mama chidi stores", phoneNumber: "08039999999", branchId: "branch-1" },
    });
    expect((await res.json()).customer.branchId).toBe("branch-1");
  });

  it("lets an EMR-saved customer with no phone keep saving without one", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf({ ...buyer, phoneNumber: "" })).mockReturnValue(leanOf(null));
    buyerUpdate.mockReturnValue(leanOf({ ...buyer, phoneNumber: "", name: "Nitro Yogurt" }));
    expect((await patch({ name: "Nitro Yogurt" })).status).toBe(200);
  });
});
