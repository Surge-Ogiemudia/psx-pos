import { MongoClient } from 'mongodb';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("No MONGODB_URI found");
    return;
  }
  
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  
  const plans = await db.collection("management_plans").find({}).sort({createdAt: -1}).limit(5).toArray();
  console.log("Latest plans:", JSON.stringify(plans, null, 2));
  
  await client.close();
}

run();
