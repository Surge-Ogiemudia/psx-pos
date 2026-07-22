import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import User from './src/models/User';

async function test() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  
  // Find a staff member
  const localUser = await User.findOne({ role: 'staff' }).sort({ _id: -1 }).lean();
  console.log("Local User:", localUser);
  
  if (localUser) {
    console.log("Pharmacy ID to string:", localUser.pharmacyId?.toString());
    console.log("Branch ID to string:", localUser.branchId?.toString());
  }

  process.exit(0);
}
test().catch(console.error);
