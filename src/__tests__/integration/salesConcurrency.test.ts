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

function makeSaleRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sales", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/sales — concurrent stock decrement", () => {
  let POST: typeof import("@/app/api/sales/route").POST;
  let Product: typeof import("@/models/Product").default;
  let Sale: typeof import("@/models/Sale").default;

  beforeAll(async () => {
    await connectTestDb();
    ({ POST } = await import("@/app/api/sales/route"));
    ({ default: Product } = await import("@/models/Product"));
    ({ default: Sale } = await import("@/models/Sale"));
    const { auth } = await import("@/auth");
    (auth as jest.Mock).mockResolvedValue(FAKE_SESSION);
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it("never oversells when two sales race for the last unit in stock", async () => {
    const product = await Product.create({
      pharmacyId: FAKE_SESSION.user.pharmacyId,
      branchId: FAKE_SESSION.user.branchId,
      itemName: "Paracetamol",
      brand: "Emzor",
      size: "500mg",
      category: "medicine",
      quantityInStock: 1,
      retailPrice: 100,
      wholesalePrice: 90,
      distributorPrice: 80,
    });

    const body = {
      branchId: FAKE_SESSION.user.branchId,
      payments: [{ method: "cash", amount: 100 }],
      items: [{ productId: product._id.toString(), quantity: 1, priceTier: "retail" }],
    };

    const [resA, resB] = await Promise.all([POST(makeSaleRequest(body)), POST(makeSaleRequest(body))]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 400]);

    const finalProduct = await Product.findById(product._id).lean();
    expect(finalProduct!.quantityInStock).toBe(0);

    const salesForProduct = await Sale.countDocuments({ "items.productId": product._id });
    expect(salesForProduct).toBe(1);
  });

  it("allows a normal sale to succeed and decrement stock correctly", async () => {
    const product = await Product.create({
      pharmacyId: FAKE_SESSION.user.pharmacyId,
      branchId: FAKE_SESSION.user.branchId,
      itemName: "Amoxicillin",
      brand: "GSK",
      size: "250mg",
      category: "medicine",
      quantityInStock: 10,
      retailPrice: 50,
      wholesalePrice: 40,
      distributorPrice: 30,
    });

    const res = await POST(
      makeSaleRequest({
        branchId: FAKE_SESSION.user.branchId,
        payments: [{ method: "cash", amount: 150 }],
        items: [{ productId: product._id.toString(), quantity: 3, priceTier: "retail" }],
      })
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sale.totalAmount).toBe(150);

    const finalProduct = await Product.findById(product._id).lean();
    expect(finalProduct!.quantityInStock).toBe(7);
  });
});
