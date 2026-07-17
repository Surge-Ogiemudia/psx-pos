const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://psxnig_db_user:BhMzX7OgfyoMNkF4@cluster0.06byfg6.mongodb.net/psxemr?appName=Cluster0";

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
