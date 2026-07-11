import mongoose from "mongoose";
import { gunzipSync } from "zlib";
import { readFileSync } from "fs";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error(
    "MONGODB_URI is not set. Run with:\n" +
      "  node --env-file=.env.local scripts/restore-backup.mjs <path-or-url-to-backup.json.gz> --yes"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--yes");

if (!source) {
  console.error(
    "Usage: node --env-file=.env.local scripts/restore-backup.mjs <path-or-url-to-backup.json.gz> --yes\n" +
      "<path-or-url> can be a local file path or a Vercel Blob URL (the same one the backup route returns)."
  );
  process.exit(1);
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// The backup route JSON.stringify's real BSON documents (see src/app/api/cron/backup/route.ts),
// which flattens ObjectId/Date fields down to plain hex/ISO strings. There's no schema left to
// know which field is which type by name alone, so revive them structurally: any string that's
// exactly a 24-char hex id or an ISO-8601 timestamp is unambiguously one of those two types —
// no real app data (names, brands, etc.) collides with either pattern.
function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = revive(v);
    return out;
  }
  if (typeof value === "string") {
    if (OBJECT_ID_RE.test(value)) return new mongoose.Types.ObjectId(value);
    if (ISO_DATE_RE.test(value)) return new Date(value);
  }
  return value;
}

async function loadDump(src) {
  let gzipped;
  if (src.startsWith("http://") || src.startsWith("https://")) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to download backup: ${res.status} ${res.statusText}`);
    gzipped = Buffer.from(await res.arrayBuffer());
  } else {
    gzipped = readFileSync(src);
  }
  return JSON.parse(gunzipSync(gzipped).toString("utf8"));
}

async function main() {
  if (!confirmed) {
    console.error(
      "This restores every document from the backup into the database MONGODB_URI points at, " +
        "upserted by _id — anything in the backup overwrites the current document with that _id; " +
        "documents NOT in the backup are left alone (nothing is deleted).\n\n" +
        "Re-run with --yes once you're sure this is the right database and backup file."
    );
    process.exit(1);
  }

  console.log(`Loading backup from ${source}...`);
  const dump = revive(await loadDump(source));

  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB.`);

  const db = mongoose.connection.db;
  let totalDocs = 0;
  for (const [collectionName, docs] of Object.entries(dump)) {
    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`  ${collectionName}: 0 documents, skipped`);
      continue;
    }
    const collection = db.collection(collectionName);
    const ops = docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    await collection.bulkWrite(ops, { ordered: false });
    console.log(`  ${collectionName}: restored ${docs.length} document(s)`);
    totalDocs += docs.length;
  }

  console.log(`Done. Restored ${totalDocs} document(s) across ${Object.keys(dump).length} collection(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
