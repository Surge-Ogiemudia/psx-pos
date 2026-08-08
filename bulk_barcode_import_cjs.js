const mongoose = require('mongoose');
const xlsx = require('xlsx');

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

  let updateCount = 0;
  
  const upcMap = new Map();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const upc = row[upcIndex];
    let itemName = row[itemNameIndex];
    if (upc && itemName) {
      itemName = itemName.trim();
      upcMap.set(itemName.toLowerCase(), upc.toString().trim());
    }
  }

  console.log(`Found ${upcMap.size} unique items with UPCs in Excel.`);

  const products = await Product.find({});
  console.log(`Loaded ${products.length} products from Database.`);

  for (const product of products) {
    if (product.barcode) continue;
    
    const dbName = (product.itemName || "").toLowerCase().trim();
    if (upcMap.has(dbName)) {
      product.barcode = upcMap.get(dbName);
      await product.save();
      updateCount++;
    } else {
      const strippedDbName = dbName.replace(/[^\w\s]/gi, '').trim();
      for (const [qName, upc] of upcMap.entries()) {
        const strippedQName = qName.replace(/[^\w\s]/gi, '').trim();
        if (strippedQName && strippedQName === strippedDbName) {
           product.barcode = upc;
           await product.save();
           updateCount++;
           break;
        }
      }
    }
  }

  console.log(`Successfully updated ${updateCount} products with barcodes!`);
  await mongoose.disconnect();
}

run().catch(console.error);
