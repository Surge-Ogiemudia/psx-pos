const mongoose = require('mongoose');
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/psx-pos";

const schema = new mongoose.Schema({}, { strict: false });
const Pharmacy = mongoose.models.Pharmacy || mongoose.model("Pharmacy", schema);

async function run() {
  await mongoose.connect(uri);
  const pharmacies = await Pharmacy.find({});
  for (const p of pharmacies) {
    console.log(`Pharmacy: ${p.pharmacyName || p.name || p.businessName} | ID: ${p._id}`);
  }
  await mongoose.disconnect();
}
run().catch(console.error);
