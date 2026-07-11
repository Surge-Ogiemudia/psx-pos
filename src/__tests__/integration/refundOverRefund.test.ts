import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectTestDb, disconnectTestDb, clearTestDb } from "./testDb";

jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.setTimeout(60000);

const FAKE_SESSION = {
  user: {
    id: new mongoose.Types.ObjectId().toString(),
    pharmacyId: new mongoose.Types.ObjectId().toString(),
    branchId: new mongoose.Types.ObjectId().toString(),
    storeId: null,
    role: "staff" as const,
    name: "Test Cashier",
  },
};

function makeRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/refunds — over-refund prevention", () => {
  let salesPOST: typeof import("@/app/api/sales/route").POST;
  let refundsPOST: typeof import("@/app/api/refunds/route").POST;
  let Product: typeof import("@/models/Product").default;

  beforeAll(async () => {
    await connectTestDb();
    ({ POST: salesPOST } = await import("@/app/api/sales/route"));
    ({ POST: refundsPOST } = await import("@/app/api/refunds/route"));
    ({ default: Product } = await import("@/models/Product"));
    const { auth } = await import("@/auth");
    (auth as jest.Mock).mockResolvedValue(FAKE_SESSION);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it("blocks refunding more than was sold, but allows the first full refund", async () => {
    const product = await Product.create({
      pharmacyId: FAKE_SESSION.user.pharmacyId,
      branchId: FAKE_SESSION.user.branchId,
      itemName: "Vitamin C",
      brand: "Emzor",
      size: "1000mg",
      category: "medicine",
      quantityInStock: 5,
      retailPrice: 100,
      wholesalePrice: 90,
      distributorPrice: 80,
    });

    const saleRes = await salesPOST(
      makeRequest("http://localhost/api/sales", {
        branchId: FAKE_SESSION.user.branchId,
        payments: [{ method: "cash", amount: 200 }],
        items: [{ productId: product._id.toString(), quantity: 2, priceTier: "retail" }],
      })
    );
    expect(saleRes.status).toBe(201);
    const { sale } = await saleRes.json();

    const refundBody = {
      saleId: sale._id,
      branchId: FAKE_SESSION.user.branchId,
      items: [{ productId: product._id.toString(), quantity: 2 }],
      reason: "test return",
      method: "cash",
    };

    const firstRefund = await refundsPOST(makeRequest("http://localhost/api/refunds", refundBody));
    expect(firstRefund.status).toBe(201);

    const restockedProduct = await Product.findById(product._id).lean();
    expect(restockedProduct!.quantityInStock).toBe(5); // 5 - 2 sold + 2 refunded

    const secondRefund = await refundsPOST(makeRequest("http://localhost/api/refunds", refundBody));
    expect(secondRefund.status).toBe(400);
    const secondData = await secondRefund.json();
    expect(secondData.error).toMatch(/can still be returned/);

    // Stock must not have moved again from the rejected second refund.
    const finalProduct = await Product.findById(product._id).lean();
    expect(finalProduct!.quantityInStock).toBe(5);
  });
});
