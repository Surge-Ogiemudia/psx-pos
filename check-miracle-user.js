const mongoose = require('mongoose');

async function checkMiracle() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));

  const miracleUsers = await User.find({ name: new RegExp('MIRACLE', 'i') }).lean();
  console.log(`Found ${miracleUsers.length} user(s) matching MIRACLE:`);

  for (const u of miracleUsers) {
    console.log(`User ID: ${u._id} (type: ${typeof u._id}) | Name: ${u.name} | Phone: ${u.phoneNumber} | Role: ${u.role} | PharmacyId: ${u.pharmacyId} | BranchId: ${u.branchId}`);
    if (u.branchId) {
      const b = await Branch.findById(u.branchId).lean();
      console.log(`  -> Associated Branch Name: ${b ? b.branchName : 'BRANCH NOT FOUND IN DB!'}`);
    }
  }

  process.exit(0);
}

checkMiracle();
