import { NextRequest } from "next/server";

// Route logic only — the Buyer model, mongoose and the session are mocked, so this runs
// without a database.

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

// The EMR's `patients` collection, reached through the raw mongoose connection.
type PatientRow = { _id: string; fullName?: string; phoneNumber?: string };
const mockEmr: { db: unknown; rows: PatientRow[]; one: PatientRow | null } = { db: null, rows: [], one: null };
jest.mock("mongoose", () => ({
  __esModule: true,
  default: {
    Types: {
      ObjectId: class {
        constructor(public value: string) {}
      },
    },
    connection: {
      get db() {
        return mockEmr.db;
      },
    },
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

function emrDb() {
  return {
    collection: jest.fn(() => ({
      find: () => ({ limit: () => ({ toArray: async () => mockEmr.rows }) }),
      findOne: async () => mockEmr.one,
    })),
  };
}

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

beforeEach(() => {
  jest.clearAllMocks();
  mockEmr.db = emrDb();
  mockEmr.rows = [];
  mockEmr.one = null;
});

describe("GET /api/pos-customers", () => {
  it("returns nothing for a search shorter than 2 characters, without querying", async () => {
    const res = await get("a");
    expect(await res.json()).toEqual({ customers: [] });
    expect(buyerFind).not.toHaveBeenCalled();
  });

  it("matches by name and phone, scoped to the pharmacy, and returns name + phone", async () => {
    buyerFind.mockReturnValue(
      chain([{ _id: "b1", name: "Mama Chidi Stores", nameKey: "mama chidi stores", phoneNumber: "08031234567", buyerType: "wholesaler" }])
    );
    const res = await get("0803");
    expect(await res.json()).toEqual({
      customers: [{ _id: "b1", name: "Mama Chidi Stores", phoneNumber: "08031234567", buyerType: "wholesaler", source: "buyer" }],
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

  it("also lists people saved in the EMR, marked as such, after the saved customers", async () => {
    buyerFind.mockReturnValue(chain([]));
    mockEmr.rows = [{ _id: "p1", fullName: "EL GLORY", phoneNumber: "0816 476 1526" }];
    const body = await (await get("glory")).json();
    expect(body.customers).toEqual([
      { _id: "emr:p1", name: "EL GLORY", phoneNumber: "08164761526", buyerType: "wholesaler", source: "emr", emrPatientId: "p1" },
    ]);
  });

  it("shows an EMR person once when they're already a saved customer (same phone)", async () => {
    const saved = { _id: "b1", name: "El Glory", nameKey: "el glory", phoneNumber: "08164761526", buyerType: "wholesaler" };
    buyerFind.mockReturnValueOnce(chain([saved])); // main search
    buyerFind.mockReturnValueOnce(chain([saved])); // saved-by-phone lookup
    mockEmr.rows = [{ _id: "p1", fullName: "EL GLORY", phoneNumber: "08164761526" }];
    const body = await (await get("glory")).json();
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].source).toBe("buyer");
  });

  it("still works off saved customers when the EMR records can't be reached", async () => {
    buyerFind.mockReturnValue(
      chain([{ _id: "b1", name: "Mama Chidi", nameKey: "mama chidi", phoneNumber: "08031234567", buyerType: "wholesaler" }])
    );
    mockEmr.db = null; // no EMR collection available here
    const body = await (await get("chidi")).json();
    expect(body.customers.map((c: { name: string }) => c.name)).toEqual(["Mama Chidi"]);
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

  describe("picking an EMR person (emrPatientId)", () => {
    it("saves them as a customer, keeping their phone", async () => {
      mockEmr.one = { _id: "p1", fullName: "  EL GLORY ", phoneNumber: "0816 476 1526" };
      buyerFindOne.mockReturnValue(leanOf(null));
      buyerCreate.mockResolvedValue({ _id: "n1", name: "EL GLORY", phoneNumber: "08164761526", buyerType: "wholesaler" });
      const res = await post({ emrPatientId: "p1" });
      expect(res.status).toBe(201);
      expect(buyerCreate).toHaveBeenCalledWith({
        pharmacyId: PHARMACY,
        name: "EL GLORY",
        nameKey: "el glory",
        buyerType: "wholesaler",
        phoneNumber: "08164761526",
      });
    });

    it("reuses the customer already saved with that phone instead of duplicating", async () => {
      mockEmr.one = { _id: "p1", fullName: "EL GLORY", phoneNumber: "08164761526" };
      buyerFindOne.mockReturnValueOnce(
        leanOf({ _id: "b1", name: "El Glory Ltd", phoneNumber: "08164761526", buyerType: "wholesaler" })
      );
      const res = await post({ emrPatientId: "p1" });
      expect(res.status).toBe(200);
      expect((await res.json()).customer._id).toBe("b1");
      expect(buyerCreate).not.toHaveBeenCalled();
    });

    it("allows an EMR person who has no phone on record", async () => {
      mockEmr.one = { _id: "p2", fullName: "Nitro yogurt" };
      buyerFindOne.mockReturnValue(leanOf(null));
      buyerCreate.mockResolvedValue({ _id: "n2", name: "Nitro yogurt", phoneNumber: "", buyerType: "wholesaler" });
      const res = await post({ emrPatientId: "p2" });
      expect(res.status).toBe(201);
      expect(buyerCreate.mock.calls[0][0].phoneNumber).toBe("");
    });

    it("404s when that EMR record isn't there", async () => {
      mockEmr.one = null;
      const res = await post({ emrPatientId: "missing" });
      expect(res.status).toBe(404);
      expect(buyerCreate).not.toHaveBeenCalled();
    });
  });
});
