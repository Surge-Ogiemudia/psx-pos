const { MongoClient } = require('mongodb');

const uri1 = "mongodb+srv://pharmastakx_db_user:Osafuwame007$@cluster0.tpkohgb.mongodb.net/?appName=Cluster0";
const uri2 = "mongodb+srv://pharmastakx_db_user:Osafuwame007@cluster0.tpkohgb.mongodb.net/?appName=Cluster0";

async function testConnection(uri, label) {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log(`${label} WORKED!`);
    return true;
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return false;
  } finally {
    await client.close();
  }
}

async function run() {
  console.log("Testing Password 1...");
  const p1 = await testConnection(uri1, "Password ending in '$'");
  
  if (!p1) {
    console.log("\nTesting Password 2...");
    await testConnection(uri2, "Password without '$'");
  }
}

run();
