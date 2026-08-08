const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const Sale = mongoose.models.Sale || mongoose.model("Sale", new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(uri);
  
  const SALE_ID = new mongoose.Types.ObjectId("6a772deb4458df78b0a930e3");
  
  const sale = await Sale.findById(SALE_ID).lean();
  if (!sale) {
    console.log("Sale not found.");
  } else {
    console.log("Found sale to delete:");
    console.log(sale);
    const result = await Sale.deleteOne({ _id: SALE_ID });
    console.log(`Deleted ${result.deletedCount} sale(s).`);
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
