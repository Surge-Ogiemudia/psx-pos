const fs = require('fs');
const { MongoClient, ObjectId } = require("mongodb");

const env = fs.readFileSync(".env.local", "utf8");
let uri = env.split("\n").find(line => line.startsWith("MONGODB_URI=")).substring("MONGODB_URI=".length).replace(/["']/g, "").trim();
uri = uri.replace("&appName=", "&appName=test").replace("?appName=", "?appName=test");

const KOP_PHARMACY_ID = "6a770a5269eeb1c414b0c939";

async function run() {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    
    let branch = await db.collection("branches").findOne({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    let store = await db.collection("stores").findOne({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    
    const products = await db.collection("products").find({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) }).toArray();
    
    console.log(`Found ${products.length} products. Syncing to storeproducts...`);
    
    let successCount = 0;
    for (const p of products) {
        try {
            await db.collection("storeproducts").updateOne(
                {
                   pharmacyId: p.pharmacyId,
                   storeId: store._id,
                   itemName: p.itemName,
                   brand: p.brand,
                   size: p.size,
                },
                {
                   $setOnInsert: {
                       category: p.category,
                       baseUnitName: "piece",
                       quantityInStock: p.quantityInStock,
                       createdAt: new Date(),
                       updatedAt: new Date()
                   }
                },
                { upsert: true }
            );
            successCount++;
        } catch(e) {
            // Ignore duplicates
        }
    }
    
    const spCount = await db.collection("storeproducts").countDocuments({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    console.log(`Done! StoreProducts count is now ${spCount}. Successfully processed ${successCount} items.`);
    
    await client.close();
}

run().catch(console.error);
