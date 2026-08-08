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
    
    const count = await db.collection("products").countDocuments({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    const spCount = await db.collection("storeproducts").countDocuments({ pharmacyId: new ObjectId(KOP_PHARMACY_ID) });
    
    console.log(`Verified DB! KOP Pharmacy now has ${count} global products and ${spCount} store inventory items.`);
    
    await client.close();
}

run().catch(console.error);
