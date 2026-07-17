const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const mongoUri = env.match(/MONGODB_URI=["']?(.*?)["']?(\n|$)/)[1];

const { MongoClient } = require('mongodb');

async function run() {
  if (!mongoUri) throw new Error("No MONGODB_URI");
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db();
    
    const emptyProducts = await db.collection('storeproducts').find({
      $or: [
        { itemName: { $exists: false } },
        { itemName: "" },
        { itemName: null }
      ]
    }).toArray();
    
    console.log(`Found ${emptyProducts.length} empty products.`);
    
    for (const p of emptyProducts) {
      console.log(`Updating product ${p._id}...`);
      await db.collection('storeproducts').updateOne(
        { _id: p._id },
        { $set: { itemName: p.name || "Recovered Item", brand: "Unknown", size: "Standard" } }
      );
    }
    console.log("Done!");
  } finally {
    await client.close();
  }
}

run().catch(console.error);
