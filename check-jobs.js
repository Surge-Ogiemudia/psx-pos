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
    
    // Find ALL Scan Jobs
    const jobs = await db.collection("scanjobs").find({}).sort({ updatedAt: -1 }).toArray();
    
    let maxPages = 0;
    let maxJob = null;
    
    jobs.forEach(j => {
      const donePages = j.pages ? j.pages.filter(p => p.status === "done").length : 0;
      if (donePages > maxPages) {
        maxPages = donePages;
        maxJob = j;
      }
    });
    
    if (maxJob) {
      console.log(`Max pages processed: ${maxPages}`);
      console.log(`Job ID: ${maxJob._id}`);
      console.log(`Pharmacy ID: ${maxJob.pharmacyId}`);
      console.log(`User ID: ${maxJob.userId}`);
      console.log(`File: ${maxJob.fileName}`);
    } else {
      console.log("No jobs found with done pages.");
    }
    
  } finally {
    await client.close();
  }
}

run().catch(console.error);
