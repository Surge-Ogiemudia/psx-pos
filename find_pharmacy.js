const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";

const schema = new mongoose.Schema({
  name: String,
}, { strict: false });

const Pharmacy = mongoose.models.Pharmacy || mongoose.model("Pharmacy", schema);
const Product = mongoose.models.Product || mongoose.model("Product", new mongoose.Schema({}, { strict: false }));

async function run() {
  await mongoose.connect(uri);
  const pharmacies = await Pharmacy.find({});
  for (const p of pharmacies) {
    const count = await Product.countDocuments({ pharmacyId: p._id });
    console.log(`Pharmacy: ${p.name} | ID: ${p._id} | Products: ${count}`);
  }
  await mongoose.disconnect();
}

run().catch(console.error);
