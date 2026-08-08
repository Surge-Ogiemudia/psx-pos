import mongoose from 'mongoose';
import xlsx from 'xlsx';

// Adjust this path if the script is run from a different directory
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";

const schema = new mongoose.Schema({
  itemName: String,
  brand: String,
  barcode: String
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
  const sizeIndex = headers.indexOf('Size');
  // QB often combines size or brand into alternate fields, but in this case, itemName matches best.

  let updateCount = 0;
  
  // Create a map from QB Item Name to UPC
  const upcMap = new Map();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const upc = row[upcIndex];
    let itemName = row[itemNameIndex];
    if (upc && itemName) {
      // Clean up string just in case
      itemName = itemName.trim();
      upcMap.set(itemName.toLowerCase(), upc.toString().trim());
    }
  }

  console.log(`Found ${upcMap.size} unique items with UPCs in Excel.`);

  // Load all products
  const products = await Product.find({});
  console.log(`Loaded ${products.length} products from Database.`);

  for (const product of products) {
    if (product.barcode) continue; // Already has barcode
    
    const dbName = (product.itemName || "").toLowerCase().trim();
    if (upcMap.has(dbName)) {
      const upc = upcMap.get(dbName);
      product.barcode = upc;
      await product.save();
      updateCount++;
    } else {
      // Try fuzzy matching or stripping dots just in case
      const strippedDbName = dbName.replace(/[^\w\s]/gi, '').trim();
      let matched = false;
      for (const [qName, upc] of upcMap.entries()) {
        const strippedQName = qName.replace(/[^\w\s]/gi, '').trim();
        if (strippedQName && strippedQName === strippedDbName) {
           product.barcode = upc;
           await product.save();
           updateCount++;
           matched = true;
           break;
        }
      }
    }
  }

  console.log(`Successfully updated ${updateCount} products with barcodes!`);
  await mongoose.disconnect();
}

run().catch(console.error);
