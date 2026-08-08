const fs = require("fs");
const { MongoClient } = require("mongodb");

const env = fs.readFileSync(".env.local", "utf8");
let uri = env.split("\n").find(line => line.startsWith("MONGODB_URI=")).substring("MONGODB_URI=".length).replace(/["']/g, "").trim();
uri = uri.replace("&appName=", "&appName=test").replace("?appName=", "?appName=test");

async function run() {
  if (!uri) throw new Error("No MONGODB_URI found");
  
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    // Find most recent pharmacies
    const pharmacies = await db.collection("pharmacies").find({}).sort({ createdAt: -1 }).limit(3).toArray();
    
    console.log(`Found ${pharmacies.length} recent pharmacies.`);
    pharmacies.forEach(p => {
      console.log(`\nPharmacy Name: ${p.pharmacyName}`);
      console.log(`ID: ${p._id}`);
      console.log(`Created At: ${p.createdAt}`);
      console.log(`Branches: ${p.branches ? p.branches.length : 0}`);
    });
    
  } finally {
    await client.close();
  }
}

run().catch(console.error);
