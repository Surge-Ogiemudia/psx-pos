const mongoose = require('mongoose');

async function simulateLogin() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));

  // Find the new user created recently or all staff
  const staffUsers = await User.find({ role: { $ne: 'admin' } }).lean();
  console.log(`Found ${staffUsers.length} staff users in POS DB:`);

  for (const u of staffUsers) {
    console.log(`User: ${u.name} (${u._id}) | Phone: ${u.phoneNumber} | BranchId in POS DB: ${u.branchId}`);
    if (u.branchId) {
      const b = await Branch.findById(u.branchId).lean();
      console.log(`  -> Branch Name in POS DB: ${b ? b.branchName : 'NOT FOUND'}`);
    }
  }

  process.exit(0);
}

simulateLogin();
