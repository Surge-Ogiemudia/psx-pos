const fs = require('fs');
const path = require('path');

// Dynamically resolve mongoose
let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = require('C:/Users/HP/Desktop/zipped pharmastackx/node_modules/mongoose');
}

// Load .env.local
const envPath = path.resolve(__dirname, '../.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const mongoUri = env.split('\n').find(l => l.startsWith('MONGODB_URI=')).slice('MONGODB_URI='.length).trim();

const PHARMACY_ID = '6aa3cdfd7f1e8b4387e43c22';
const BRANCH_ID = '6aa3d0fde6b6e0f4c19e695a';

async function run() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const draftsCollection = db.collection('aidraftproducts');

  // Dynamic import of TypeScript reviewFlags
  const { computeReviewFlags } = await import('../src/lib/reviewFlags.ts');

  const pharmacyObjectId = new mongoose.Types.ObjectId(PHARMACY_ID);
  const branchObjectId = new mongoose.Types.ObjectId(BRANCH_ID);

  // 1. Query all drafts for APCare Pharmacy that have missing_expiry in needsReviewReason
  const query = {
    pharmacyId: pharmacyObjectId,
    branchId: branchObjectId,
    needsReviewReason: 'missing_expiry'
  };

  const draftsToUpdate = await draftsCollection.find(query).toArray();
  console.log(`Found ${draftsToUpdate.length} drafts with 'missing_expiry' for APCare Pharmacy.`);

  let updatedCount = 0;
  let readyToPublishCount = 0;
  let remainedZeroPriceCount = 0;
  const flagDistribution = {};

  for (const draft of draftsToUpdate) {
    draft.expiryConfirmed = true;
    const newReasons = computeReviewFlags(draft);

    await draftsCollection.updateOne(
      { _id: draft._id },
      {
        $set: {
          expiryConfirmed: true,
          needsReviewReason: newReasons
        }
      }
    );

    updatedCount++;

    if (newReasons.length === 0) {
      readyToPublishCount++;
    } else {
      if (newReasons.includes('zero_price')) {
        remainedZeroPriceCount++;
      }
      for (const flag of newReasons) {
        flagDistribution[flag] = (flagDistribution[flag] || 0) + 1;
      }
    }
  }

  // 2. Verify remaining missing_expiry count for APCare Pharmacy
  const remainingMissingExpiry = await draftsCollection.countDocuments({
    pharmacyId: pharmacyObjectId,
    branchId: branchObjectId,
    needsReviewReason: 'missing_expiry'
  });

  console.log(`\n======================================================`);
  console.log(`🎉 BATCH UPDATE COMPLETE FOR APCARE PHARMACY`);
  console.log(`======================================================`);
  console.log(`Total drafts updated: ${updatedCount}`);
  console.log(`Moved to Ready to Publish (0 flags): ${readyToPublishCount}`);
  console.log(`Remained with zero_price: ${remainedZeroPriceCount}`);
  console.log(`Flag distribution among remaining items needing review:`, flagDistribution);
  console.log(`------------------------------------------------------`);
  console.log(`Verification: Remaining 'missing_expiry' count for APCare: ${remainingMissingExpiry}`);
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Fatal error during migration:", err);
  process.exit(1);
});
