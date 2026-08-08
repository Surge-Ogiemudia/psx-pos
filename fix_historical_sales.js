const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const Product = mongoose.models.Product || mongoose.model("Product", new mongoose.Schema({}, { strict: false }));
const Sale = mongoose.models.Sale || mongoose.model("Sale", new mongoose.Schema({}, { strict: false }));
const Refund = mongoose.models.Refund || mongoose.model("Refund", new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(uri);
  
  console.log("Loading products...");
  const products = await Product.find({ costPrice: { $exists: true } }).lean();
  const costMap = new Map();
  for (const p of products) {
    costMap.set(p._id.toString(), p.costPrice || 0);
  }

  console.log("Loading sales...");
  const sales = await Sale.find({}).lean();
  const saleOps = [];
  for (const sale of sales) {
    let saleTotalCost = 0;
    const items = sale.items.map(item => {
      const unitCost = costMap.get(item.productId?.toString()) || 0;
      const costTotal = unitCost * item.quantity;
      saleTotalCost += costTotal;
      return { ...item, unitCost, costTotal };
    });
    
    // Check if we actually need to update this sale (e.g. totalCost changed or missing)
    if (sale.totalCost !== saleTotalCost) {
       saleOps.push({
         updateOne: {
           filter: { _id: sale._id },
           update: { $set: { items, totalCost: saleTotalCost } }
         }
       });
    }
  }

  if (saleOps.length > 0) {
    console.log(`Updating ${saleOps.length} sales...`);
    for (let i = 0; i < saleOps.length; i += 1000) {
      await Sale.collection.bulkWrite(saleOps.slice(i, i + 1000));
    }
  } else {
    console.log("No sales needed updating.");
  }

  console.log("Loading refunds...");
  const refunds = await Refund.find({}).lean();
  const refundOps = [];
  for (const refund of refunds) {
    let refundTotalCost = 0;
    const items = refund.items.map(item => {
      const unitCost = costMap.get(item.productId?.toString()) || 0;
      const costTotal = unitCost * item.quantity;
      refundTotalCost += costTotal;
      return { ...item, unitCost, costTotal };
    });
    
    if (refund.totalCost !== refundTotalCost) {
       refundOps.push({
         updateOne: {
           filter: { _id: refund._id },
           update: { $set: { items, totalCost: refundTotalCost } }
         }
       });
    }
  }
  
  if (refundOps.length > 0) {
    console.log(`Updating ${refundOps.length} refunds...`);
    for (let i = 0; i < refundOps.length; i += 1000) {
      await Refund.collection.bulkWrite(refundOps.slice(i, i + 1000));
    }
  } else {
    console.log("No refunds needed updating.");
  }

  console.log(`Done! Updated ${saleOps.length} sales and ${refundOps.length} refunds.`);
  await mongoose.disconnect();
}

run().catch(console.error);
