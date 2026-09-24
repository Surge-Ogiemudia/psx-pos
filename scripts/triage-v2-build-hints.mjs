// Builds Triage v2 price hints for Monak snap-origin products with no retail price.
// Usage: node scripts/triage-v2-build-hints.mjs [--dry-run | --write]   (default --dry-run)
// NOTE: scoring logic duplicates src/lib/triageV2/hints.ts (plain ESM cannot import TS). Keep in sync.
import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const WRITE = process.argv.includes("--write");
const PHARMACY_ID = new ObjectId("6a5f61da9e1719c3b02842ae");
const BRANCH_ID = new ObjectId("6a5f6f7b5e854aa2925274b4");
const MIN_HINT_SCORE = 0.7, MAX_HINTS = 3, BONUS = 0.05, PENALTY = 0.15;

function readUri() {
  const env = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const m = env.match(/^\s*MONGODB_URI\s*=\s*(.*)$/m);
  if (!m) throw new Error("MONGODB_URI missing in .env.local");
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

const productMatchName = (n, s) => { const z = (s ?? "").trim(); return z && z.toLowerCase() !== "standard" ? `${n} ${z}` : n; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function bigramMap(s) {
  const n = norm(s), map = new Map(); let total = 0;
  for (let i = 0; i < n.length - 1; i++) { const g = n.slice(i, i + 2); map.set(g, (map.get(g) ?? 0) + 1); total++; }
  return { map, total };
}
const nums = (s) => (String(s ?? "").toLowerCase().match(/\d+(?:\.\d+)?/g) ?? []).sort();
const dice = (o, a, b) => (a + b === 0 ? 0 : (2 * o) / (a + b));
function adjust(d, A, B) {
  let s = d;
  if (A.length && B.length) s += A.length === B.length && A.every((t, i) => t === B[i]) ? BONUS : -PENALTY;
  return Math.max(0, Math.min(1, s));
}
function buildIndex(input) {
  const seen = new Set(), rows = [], totals = [], numsArr = [], postings = new Map();
  for (const r of input) {
    if (!(r.retailPrice > 0) || r.wholesalePrice > r.retailPrice) continue;
    const key = `${norm(r.itemName)}|${r.retailPrice}|${r.wholesalePrice}|${r.distributorPrice}`;
    if (seen.has(key)) continue; seen.add(key);
    const idx = rows.length, { map, total } = bigramMap(r.itemName);
    rows.push(r); totals.push(total); numsArr.push(nums(r.itemName));
    for (const [g, c] of map) { let p = postings.get(g); if (!p) postings.set(g, (p = [])); p.push([idx, c]); }
  }
  return { rows, totals, nums: numsArr, postings };
}
function findHints(ix, name) {
  const q = bigramMap(name); if (!q.total) return [];
  const qn = nums(name), overlap = new Map();
  for (const [g, qc] of q.map) {
    const p = ix.postings.get(g); if (!p) continue;
    for (const [i, c] of p) overlap.set(i, (overlap.get(i) ?? 0) + Math.min(qc, c));
  }
  const out = [];
  for (const [i, ov] of overlap) {
    const score = adjust(dice(ov, q.total, ix.totals[i]), qn, ix.nums[i]);
    if (score < MIN_HINT_SCORE) continue;
    const r = ix.rows[i];
    out.push({ name: r.itemName, retailPrice: r.retailPrice, wholesalePrice: r.wholesalePrice, distributorPrice: r.distributorPrice, score: Math.round(score * 1000) / 1000 });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, MAX_HINTS);
}

const client = new MongoClient(readUri());
await client.connect();
try {
  const db = client.db();
  const t0 = Date.now();
  const excel = await db.collection("monakexcel2s").find({ pharmacyId: PHARMACY_ID }).project({ itemName: 1, retailPrice: 1, wholesalePrice: 1, distributorPrice: 1 }).toArray();
  const ix = buildIndex(excel);
  const snapIds = await db.collection("aidraftproducts").distinct("productId", { productId: { $ne: null } });
  const products = await db.collection("products").find({
    pharmacyId: PHARMACY_ID, branchId: BRANCH_ID, _id: { $in: snapIds },
    $or: [{ retailPrice: 0 }, { retailPrice: null }, { retailPrice: { $exists: false } }],
  }).project({ itemName: 1, size: 1, retailPrice: 1 }).toArray();
  console.log(`excel rows: ${excel.length} (usable unique: ${ix.rows.length}); zero-price snap products: ${products.length}`);

  const results = products.map((p) => { const name = productMatchName(p.itemName, p.size); return { p, name, hints: findHints(ix, name) }; });
  const dist = [0, 0, 0, 0];
  for (const r of results) dist[r.hints.length]++;
  console.log(`hints: 1=${dist[1]} 2=${dist[2]} 3=${dist[3]} none=${dist[0]}  (${Date.now() - t0}ms)`);

  const sample = [...results].sort(() => Math.random() - 0.5).slice(0, 15);
  for (const r of sample) {
    console.log(`\n* ${r.name}`);
    if (!r.hints.length) console.log("    (no hints)");
    for (const h of r.hints) console.log(`    ${h.score.toFixed(3)}  ${h.name}  retail=${h.retailPrice} whole=${h.wholesalePrice} dist=${h.distributorPrice}`);
  }

  if (!WRITE) {
    console.log("\nDRY RUN: nothing written.");
  } else {
    const col = db.collection("triagepricehints");
    const now = new Date(), ops = [];
    for (const r of results) {
      const filter = { pharmacyId: PHARMACY_ID, branchId: BRANCH_ID, productId: r.p._id };
      if (!r.hints.length) ops.push({ deleteOne: { filter } });
      else ops.push({ updateOne: { filter, update: { $set: { hints: r.hints, computedAt: now } }, upsert: true } });
    }
    if (ops.length) await col.bulkWrite(ops, { ordered: false });
    // remove hint docs for products that now have a price / are no longer zero-price snap products
    const zeroIds = new Set(products.map((p) => String(p._id)));
    const existing = await col.find({ pharmacyId: PHARMACY_ID, branchId: BRANCH_ID }, { projection: { productId: 1 } }).toArray();
    const stale = existing.filter((d) => !zeroIds.has(String(d.productId))).map((d) => d._id);
    if (stale.length) await col.deleteMany({ _id: { $in: stale } });
    console.log(`WROTE: ${ops.length} ops, removed ${stale.length} stale.`);
  }
} finally {
  await client.close();
}
