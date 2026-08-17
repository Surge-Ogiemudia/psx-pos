import { MongoClient, ObjectId } from "mongodb";
import fs from "fs";

function cleanStr(s) {
  return (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function diceSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;
  const bigrams1 = new Set();
  for (let i = 0; i < str1.length - 1; i++) {
    bigrams1.add(str1.substring(i, i + 2));
  }
  let intersection = 0;
  for (let i = 0; i < str2.length - 1; i++) {
    const bigram = str2.substring(i, i + 2);
    if (bigrams1.has(bigram)) intersection++;
  }
  return (2.0 * intersection) / (str1.length + str2.length - 2);
}

async function run() {
  const jsonPath = "C:\\Users\\HP\\.gemini\\antigravity\\brain\\00266870-8ce4-4870-b31a-e1469d565c2d\\scratch\\cleaned_monak_inventory.json";
  const enrichedItems = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const envFile = fs.readFileSync(".env.local", "utf8");
  let uri = "";
  for (const line of envFile.split("\n")) {
    if (line.startsWith("MONGODB_URI=")) {
      uri = line.split("=")[1].trim();
      break;
    }
  }
  if (uri.endsWith("?appName")) uri = uri.replace("?appName", "");
  else if (uri.includes("?appName&")) uri = uri.replace("?appName&", "?");

  const client = new MongoClient(uri || "mongodb://127.0.0.1:27017/psx-pos");
  await client.connect();
  const db = client.db();

  const monakId = new ObjectId("6a5f61da9e1719c3b02842ae");

  console.log("Fetching Monak DB products...");
  const dbProducts = await db.collection("products").find({ pharmacyId: monakId }).toArray();
  console.log(`Loaded ${dbProducts.length} DB products.`);

  const dbCleanList = dbProducts.map(p => ({
    product: p,
    cleanName: cleanStr(p.itemName),
    cleanBrand: cleanStr(p.brand)
  }));

  console.log(`\nDeleting existing BulkReconciliationItem records for Monak...`);
  await db.collection("bulkreconciliationitems").deleteMany({ pharmacyId: monakId });

  console.log(`Computing fuzzy match candidates for ${enrichedItems.length} items...`);

  const now = new Date();
  const docsToInsert = [];

  for (let i = 0; i < enrichedItems.length; i++) {
    const item = enrichedItems[i];
    const excelName = item.itemName;
    const cleanExcel = cleanStr(excelName);

    // Compute similarity against all DB products
    const matches = [];

    dbCleanList.forEach(c => {
      let score = diceSimilarity(cleanExcel, c.cleanName);

      // Boost if exact normalized match
      if (cleanExcel === c.cleanName) score = 1.0;

      if (score >= 0.30) {
        matches.push({
          productId: c.product._id,
          productName: c.product.itemName,
          score: Math.round(score * 100)
        });
      }
    });

    // Sort candidates descending by score and pick top 5
    matches.sort((a, b) => b.score - a.score);
    const topMatches = matches.slice(0, 5);

    // Auto-pre-select top match if score >= 90%
    const isHighMatch = topMatches.length > 0 && topMatches[0].score >= 90;

    docsToInsert.push({
      pharmacyId: monakId,
      excelItemName: item.itemName,
      brand: item.brand,
      size: item.size,
      category: item.category || "supermarket",
      totalQuantity: item.quantity,
      expiryDate: item.expiryDate || null,
      status: "pending",
      matchedProductId: null, // Left null until human approves in UI
      suggestedMatches: topMatches,
      matchedAt: null,
      matchedByUserId: null,
      createdAt: now,
      updatedAt: now
    });
  }

  console.log(`Inserting ${docsToInsert.length} documents into 'bulkreconciliationitems'...`);
  await db.collection("bulkreconciliationitems").insertMany(docsToInsert);

  const count = await db.collection("bulkreconciliationitems").countDocuments({ pharmacyId: monakId });
  console.log(`\n✅ SUCCESSFULLY SEEDED MONAK RECONCILIATION DATA!`);
  console.log(`Total Records in DB: ${count}`);

  await client.close();
  process.exit(0);
}

run().catch(console.error);
