const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const schema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.models.Product || mongoose.model("Product", schema);

async function run() {
  await mongoose.connect(uri);
  const KOP_PHARMACY_ID = new mongoose.Types.ObjectId("6a770a5269eeb1c414b0c939");
  
  // Set wholesalePrice and distributorPrice to 0 for KOP Pharmacy
  const result = await Product.updateMany(
    { pharmacyId: KOP_PHARMACY_ID },
    { $set: { wholesalePrice: 0, distributorPrice: 0 } }
  );

  console.log(`Updated ${result.modifiedCount} products: wholesale and distributor prices set to 0 for KOP Pharmacy.`);
  await mongoose.disconnect();
}

run().catch(console.error);
