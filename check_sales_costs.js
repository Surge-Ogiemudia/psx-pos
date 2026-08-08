const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const schema = new mongoose.Schema({}, { strict: false });
const Sale = mongoose.models.Sale || mongoose.model("Sale", schema);

async function run() {
  await mongoose.connect(uri);
  const KOP_PHARMACY_ID = new mongoose.Types.ObjectId("6a770a5269eeb1c414b0c939");
  
  const start = new Date();
  start.setHours(0,0,0,0);
  
  const sales = await Sale.find({
    pharmacyId: KOP_PHARMACY_ID,
    timestamp: { $gte: start }
  }).lean();
  
  let totalAmount = 0;
  let totalCost = 0;
  
  for (const sale of sales) {
    totalAmount += sale.totalAmount;
    totalCost += (sale.totalCost || 0);
    console.log(`Sale ID: ${sale._id}, Amount: ${sale.totalAmount}, Cost: ${sale.totalCost}`);
    for (const item of sale.items) {
      console.log(`  - Item: ${item.productName}, unitPrice: ${item.unitPrice}, unitCost: ${item.unitCost}`);
    }
  }
  
  console.log(`\nSummary:`);
  console.log(`Total Sales Amount: ${totalAmount}`);
  console.log(`Total Cost: ${totalCost}`);
  
  await mongoose.disconnect();
}

run().catch(console.error);
