const mongoose = require('mongoose');

async function checkUsers() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));

  const users = await User.find({}).lean();
  const branches = await Branch.find({}).lean();

  console.log(`Found ${users.length} users and ${branches.length} branches.`);

  for (const u of users) {
    console.log(`User: ${u.name} | Phone: ${u.phoneNumber} | Role: ${u.role} | PharmacyId: ${u.pharmacyId} | BranchId: ${u.branchId}`);
  }

  // Fix any staff user without branchId
  for (const u of users) {
    if (u.role !== 'admin' && !u.branchId && u.pharmacyId) {
      const pharmacyBranches = branches.filter(b => b.pharmacyId.toString() === u.pharmacyId.toString());
      if (pharmacyBranches.length > 0) {
        const targetBranchId = pharmacyBranches[0]._id;
        await User.updateOne({ _id: u._id }, { $set: { branchId: targetBranchId } });
        console.log(`FIXED User ${u.name}: assigned branchId ${targetBranchId}`);
      }
    }
  }

  process.exit(0);
}

checkUsers();
