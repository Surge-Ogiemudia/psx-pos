const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";
const schema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.models.Product || mongoose.model("Product", schema);

async function run() {
  await mongoose.connect(uri);
  const KOP_PHARMACY_ID = new mongoose.Types.ObjectId("6a770a5269eeb1c414b0c939");
  
  // Find products that have costPrice but DO NOT belong to KOP
  const result = await Product.updateMany(
    { 
      pharmacyId: { $ne: KOP_PHARMACY_ID },
      costPrice: { $exists: true } 
    },
    { $unset: { costPrice: "" } }
  );

  console.log(`Reversed ${result.modifiedCount} accidental cost price updates from other pharmacies.`);
  await mongoose.disconnect();
}

run().catch(console.error);
