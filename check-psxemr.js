const { MongoClient } = require('mongodb');

const uri = process.env.EMR_MONGODB_URI;

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("psxemr");
    const collections = await db.collections();
    
    console.log("--- psxemr Database Contents ---");
    let totalDocs = 0;
    for (const collection of collections) {
      const count = await collection.countDocuments();
      console.log(`${collection.collectionName}: ${count} documents`);
      totalDocs += count;
    }
    
    if (totalDocs === 0) {
      console.log("\nThe database is completely empty.");
    } else {
      console.log(`\nTotal documents across all collections: ${totalDocs}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
