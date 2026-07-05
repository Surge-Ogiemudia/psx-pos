import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error(
    "MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/migrate-sale-payments.mjs [--dry-run]"
  );
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

// Minimal local schemas (matches the existing onboard.mjs/seed.mjs convention of not importing
// the TS models from src/) — strict: false so we can read/write legacy fields these schemas
// don't declare (e.g. the old `paymentMethod` on Sale).
const SaleSchema = new mongoose.Schema({}, { strict: false, collection: "sales" });
const RefundSchema = new mongoose.Schema({}, { strict: false, collection: "refunds" });

const Sale = mongoose.model("Sale", SaleSchema);
const Refund = mongoose.model("Refund", RefundSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB${dryRun ? " (dry run — no writes will be made)" : ""}`);

  let saleCount = 0;
  const saleCursor = Sale.find({
    $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }],
  }).cursor({ batchSize: 500 });

  for await (const doc of saleCursor) {
    const legacyMethod = doc.paymentMethod || "cash";
    const update = {
      payments: [{ method: legacyMethod, amount: doc.totalAmount }],
      amountTendered: doc.totalAmount,
      changeGiven: 0,
      changeMethod: "cash",
      changeFee: 0,
    };
    if (dryRun) {
      console.log(`[dry run] Sale ${doc._id}: would set`, update);
    } else {
      await Sale.updateOne(
        { _id: doc._id, $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }] },
        { $set: update }
      );
    }
    saleCount++;
  }

  let refundCount = 0;
  let refundWarnings = 0;
  const refundCursor = Refund.find({ method: { $exists: false } }).cursor({ batchSize: 500 });

  for await (const doc of refundCursor) {
    const sale = await Sale.findById(doc.saleId).lean();
    let method = "cash";
    if (sale?.payments?.length) {
      method = sale.payments.reduce((max, p) => (p.amount > max.amount ? p : max), sale.payments[0]).method;
    } else if (!sale) {
      console.warn(`[warning] Refund ${doc._id} references missing Sale ${doc.saleId} — defaulting to "cash"`);
      refundWarnings++;
    }
    if (dryRun) {
      console.log(`[dry run] Refund ${doc._id}: would set method="${method}"`);
    } else {
      await Refund.updateOne({ _id: doc._id, method: { $exists: false } }, { $set: { method } });
    }
    refundCount++;
  }

  console.log(
    `\nDone. Sale docs ${dryRun ? "that would be " : ""}migrated: ${saleCount}. Refund docs ${dryRun ? "that would be " : ""}migrated: ${refundCount}.` +
      (refundWarnings ? ` ${refundWarnings} refund(s) had no matching sale — check the warnings above.` : "")
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
