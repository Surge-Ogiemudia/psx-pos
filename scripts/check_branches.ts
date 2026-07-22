// @ts-nocheck
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));
  const Store = mongoose.model('Store', new mongoose.Schema({}, { strict: false }));
  
  // Let's find all branches and see which pharmacy they belong to
  const branches = await Branch.find().lean();
  console.log("Branches:", branches);
  process.exit(0);
}
check().catch(console.error);
