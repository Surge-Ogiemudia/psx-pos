import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB.");
  
  const Pharmacy = mongoose.model('Pharmacy', new mongoose.Schema({}, { strict: false }));
  
  const pharmacies = await Pharmacy.find({ name: /monak/i }).lean();
  console.log("Found:", pharmacies);
  
  process.exit(0);
}

check().catch(console.error);
