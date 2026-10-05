import { NextRequest } from "next/server";

// Route logic only — the Buyer model and session are mocked, so this runs without a database.

const PHARMACY = "pharmacy-1";

jest.mock("@/lib/mongodb", () => ({ dbConnect: jest.fn() }));
jest.mock("@/lib/session", () => ({
  requireApiSession: jest.fn(async () => ({ user: { pharmacyId: "pharmacy-1" } })),
}));

const buyerFind = jest.fn();
const buyerFindOne = jest.fn();
const buyerCreate = jest.fn();
jest.mock("@/models/Buyer", () => ({
  __esModule: true,
  default: {
    find: (...a: unknown[]) => buyerFind(...a),
    findOne: (...a: unknown[]) => buyerFindOne(...a),
    create: (...a: unknown[]) => buyerCreate(...a),
  },
}));

import { GET, POST } from "@/app/api/pos-customers/route";

function chain(result: unknown[]) {
  const c: Record<string, jest.Mock> = {};
  c.sort = jest.fn(() => c);
  c.limit = jest.fn(() => c);
  c.lean = jest.fn(async () => result);
  return c;
}
const leanOf = (v: unknown) => ({ lean: async () => v });

function get(search: string) {
  return GET(new NextRequest(`http://localhost/api/pos-customers?search=${encodeURIComponent(search)}`));
}
function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/pos-customers", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/pos-customers", () => {
  it("returns nothing for a search shorter than 2 characters, without querying", async () => {
    const res = await get("a");
    expect(await res.json()).toEqual({ customers: [] });
    expect(buyerFind).not.toHaveBeenCalled();
  });

  it("matches by name and phone, scoped to the pharmacy, and returns name + phone + type", async () => {
    buyerFind.mockReturnValue(
      chain([{ _id: "b1", name: "Mama Chidi Stores", phoneNumber: "08031234567", buyerType: "wholesaler" }])
    );
    const res = await get("0803");
    expect(await res.json()).toEqual({
      customers: [{ _id: "b1", name: "Mama Chidi Stores", phoneNumber: "08031234567", buyerType: "wholesaler" }],
    });
    const filter = buyerFind.mock.calls[0][0];
    expect(filter.pharmacyId).toBe(PHARMACY);
    expect(filter.$or).toHaveLength(2); // name + phone
  });

  it("escapes regex characters so a typed '(' or '.*' can't break or abuse the query", async () => {
    buyerFind.mockReturnValue(chain([]));
    await get("a.*(b");
    const nameClause = buyerFind.mock.calls[0][0].$or[0];
    expect(nameClause.nameKey.$regex).toBe("a\\.\\*\\(b");
  });
});

describe("POST /api/pos-customers", () => {
  it("requires a name", async () => {
    const res = await post({ name: "  ", phoneNumber: "08031234567" });
    expect(res.status).toBe(400);
  });

  it("requires a real phone number", async () => {
    const res = await post({ name: "Mama Chidi", phoneNumber: "123" });
    expect(res.status).toBe(400);
    expect(buyerCreate).not.toHaveBeenCalled();
  });

  it("refuses a phone number that already belongs to someone and hands back that customer", async () => {
    buyerFindOne.mockReturnValueOnce(
      leanOf({ _id: "b9", name: "Chidi Pharmacy", phoneNumber: "08031234567", buyerType: "wholesaler" })
    );
    const res = await post({ name: "Mama Chidi", phoneNumber: "0803 123 4567" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing.name).toBe("Chidi Pharmacy");
    // spaces were stripped before comparing
    expect(buyerFindOne.mock.calls[0][0]).toEqual({ pharmacyId: PHARMACY, phoneNumber: "08031234567" });
    expect(buyerCreate).not.toHaveBeenCalled();
  });

  it("refuses a duplicate name of the same type", async () => {
    buyerFindOne.mockReturnValueOnce(leanOf(null)); // phone: free
    buyerFindOne.mockReturnValueOnce(
      leanOf({ _id: "b2", name: "Mama Chidi", phoneNumber: "08099999999", buyerType: "wholesaler" })
    );
    const res = await post({ name: "mama chidi", phoneNumber: "08031234567", buyerType: "wholesaler" });
    expect(res.status).toBe(409);
    expect((await res.json()).existing._id).toBe("b2");
  });

  it("creates the customer, defaulting the type to wholesaler, with a cleaned phone", async () => {
    buyerFindOne.mockReturnValue(leanOf(null));
    buyerCreate.mockResolvedValue({ _id: "new1", name: "Mama Chidi", phoneNumber: "08031234567", buyerType: "wholesaler" });
    const res = await post({ name: "  Mama Chidi ", phoneNumber: "0803-123-4567" });
    expect(res.status).toBe(201);
    expect(buyerCreate).toHaveBeenCalledWith({
      pharmacyId: PHARMACY,
      name: "Mama Chidi",
      nameKey: "mama chidi",
      buyerType: "wholesaler",
      phoneNumber: "08031234567",
    });
    expect((await res.json()).customer._id).toBe("new1");
  });

  it("returns the other till's customer when two tills add the same name at once (unique-index race)", async () => {
    buyerFindOne
      .mockReturnValueOnce(leanOf(null)) // phone free
      .mockReturnValueOnce(leanOf(null)) // name free at check time
      .mockReturnValueOnce(leanOf({ _id: "b3", name: "Mama Chidi", phoneNumber: "08031234567", buyerType: "wholesaler" }));
    buyerCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await post({ name: "Mama Chidi", phoneNumber: "08031234567" });
    expect(res.status).toBe(409);
    expect((await res.json()).existing._id).toBe("b3");
  });
});
