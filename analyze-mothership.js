const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://pharmastakx_db_user:Osafuwame007$@cluster0.tpkohgb.mongodb.net/?appName=Cluster0";

async function analyze() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    
    // Check what databases exist in the cluster
    const adminDb = client.db().admin();
    const listDatabasesResult = await adminDb.listDatabases();
    console.log("Databases in the cluster:");
    
    let targetDbName = "test"; // default
    
    for (const dbInfo of listDatabasesResult.databases) {
      console.log(` - ${dbInfo.name}`);
      // Find the most likely pharmastackx database
      if (dbInfo.name.includes("pharma") || dbInfo.name === "production") {
        targetDbName = dbInfo.name;
      }
    }
    
    console.log(`\nInspecting database: ${targetDbName}`);
    const db = client.db(targetDbName);
    const collections = await db.collections();
    
    for (const collection of collections) {
      const count = await collection.countDocuments();
      console.log(`\nCollection: ${collection.collectionName} (${count} documents)`);
      
      if (count > 0 && ['users', 'pharmacies', 'staff', 'accounts'].includes(collection.collectionName)) {
        const sample = await collection.findOne();
        console.log(`Sample document keys:`, Object.keys(sample).join(', '));
        if (collection.collectionName === 'users' || collection.collectionName === 'staff') {
           console.log(`Sample document role/type fields:`, { 
             role: sample.role, 
             type: sample.type, 
             email: sample.email,
             phoneNumber: sample.phoneNumber
           });
        }
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

analyze();
