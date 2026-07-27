const mongoose = require('mongoose');

async function fixMiracle() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));

  const phId = new mongoose.Types.ObjectId('6a5f61da9e1719c3b02842ae');

  // Find Santana Main Branch for Monak Pharmacy
  const branch = await Branch.findOne({ pharmacyId: phId, branchName: new RegExp('Santana', 'i') }).lean();
  
  if (branch) {
    console.log(`Found Santana Branch ID: ${branch._id} (${branch.branchName})`);
    
    const res = await User.updateMany(
      { pharmacyId: phId, name: new RegExp('MIRACLE', 'i') },
      { $set: { branchId: branch._id } }
    );
    console.log(`Updated ${res.modifiedCount} user(s) named MIRACLE to branch ${branch.branchName}.`);
  } else {
    console.log("Santana Branch not found");
  }

  process.exit(0);
}

fixMiracle();
