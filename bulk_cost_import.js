const mongoose = require('mongoose');
const xlsx = require('xlsx');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";

const schema = new mongoose.Schema({
  itemName: String,
  brand: String,
  barcode: String,
  costPrice: Number
}, { strict: false });

const Product = mongoose.models.Product || mongoose.model("Product", schema);

async function run() {
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const workbook = xlsx.readFile('C:\\Users\\HP\\Desktop\\KOP\\QB POS Inventory Items Export.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  const headers = data[0];
  const upcIndex = headers.indexOf('UPC');
  const itemNameIndex = headers.indexOf('Item Name');
  const costIndex = headers.indexOf('Average Unit Cost');

  let updateCount = 0;
  
  // Map of lowercase itemName -> { cost, upc }
  const itemMap = new Map();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const upc = row[upcIndex];
    let itemName = row[itemNameIndex];
    let cost = row[costIndex];
    
    if (itemName && cost !== undefined && cost !== null) {
      itemName = itemName.trim();
      const parsedCost = parseFloat(cost) || 0;
      itemMap.set(itemName.toLowerCase(), {
        cost: parsedCost,
        upc: upc ? upc.toString().trim() : null
      });
    }
  }

  console.log(`Found ${itemMap.size} unique items with Average Unit Cost in Excel.`);

  const KOP_PHARMACY_ID = new mongoose.Types.ObjectId("6a770a5269eeb1c414b0c939");
  const products = await Product.find({ pharmacyId: KOP_PHARMACY_ID });
  console.log(`Loaded ${products.length} products from Database for KOP Pharmacy.`);

  for (const product of products) {
    let matchedCost = null;
    const dbName = (product.itemName || "").toLowerCase().trim();
    
    // First try matching exactly by name
    if (itemMap.has(dbName)) {
      matchedCost = itemMap.get(dbName).cost;
    } else {
      // Fuzzy name match by stripping punctuation
      const strippedDbName = dbName.replace(/[^\w\s]/gi, '').trim();
      for (const [qName, data] of itemMap.entries()) {
        const strippedQName = qName.replace(/[^\w\s]/gi, '').trim();
        if (strippedQName && strippedQName === strippedDbName) {
           matchedCost = data.cost;
           break;
        }
      }
    }
    
    // Fallback try matching by barcode
    if (matchedCost === null && product.barcode) {
      for (const [qName, data] of itemMap.entries()) {
         if (data.upc === product.barcode) {
            matchedCost = data.cost;
            break;
         }
      }
    }

    if (matchedCost !== null) {
       // Only update if it's changing
       if (product.costPrice !== matchedCost) {
         product.costPrice = matchedCost;
         await product.save();
         updateCount++;
       }
    }
  }

  console.log(`Successfully updated ${updateCount} products with Cost Prices!`);
  await mongoose.disconnect();
}

run().catch(console.error);
