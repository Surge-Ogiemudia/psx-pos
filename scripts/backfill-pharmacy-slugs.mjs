import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error(
    "MONGODB_URI is not set. Run with:\n" +
      "  node --env-file=.env.local scripts/backfill-pharmacy-slugs.mjs [--yes]"
  );
  process.exit(1);
}

const confirmed = process.argv.includes("--yes");

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PharmacySchema = new mongoose.Schema(
  { pharmacyName: String, slug: String },
  { timestamps: true, strict: false }
);
const Pharmacy = mongoose.model("Pharmacy", PharmacySchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const missingSlug = await Pharmacy.find({ $or: [{ slug: { $exists: false } }, { slug: "" }, { slug: null }] });
  if (missingSlug.length === 0) {
    console.log("Every pharmacy already has a slug — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const existingSlugs = new Set(
    (await Pharmacy.find({ slug: { $nin: [null, ""] } }).select("slug")).map((p) => p.slug)
  );

  const plan = [];
  for (const pharmacy of missingSlug) {
    let base = slugify(pharmacy.pharmacyName);
    let slug = base;
    let suffix = 2;
    // Guard against two pharmacy names slugifying to the same value (none expected among the
    // current 3, but cheap to handle correctly rather than let a unique-index write fail).
    while (existingSlugs.has(slug) || plan.some((p) => p.slug === slug)) {
      slug = `${base}-${suffix++}`;
    }
    plan.push({ id: pharmacy._id, name: pharmacy.pharmacyName, slug });
  }

  console.log("Planned slug assignments:");
  for (const p of plan) {
    console.log(`  ${p.name.padEnd(30)} -> ${p.slug}  (https://${p.slug}.pos.psx.ng)`);
  }

  if (!confirmed) {
    console.log("\nDry run only — re-run with --yes to apply.");
    await mongoose.disconnect();
    return;
  }

  for (const p of plan) {
    await Pharmacy.updateOne({ _id: p.id }, { $set: { slug: p.slug } });
  }
  console.log(`\nDone. Set a slug on ${plan.length} pharmac${plan.length === 1 ? "y" : "ies"}.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
