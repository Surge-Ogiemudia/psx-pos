const mongoose = require('mongoose');
const fs = require('fs');

async function run() {
  try {
    const uri = fs.readFileSync('.env.local', 'utf8').match(/MONGODB_URI=(.*)/)[1];
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const Pharmacy = mongoose.model('Pharmacy', new mongoose.Schema({}, { strict: false }));
    
    const localUser = await User.findById('6a6064e7d30116d123ed87c7').lean();
    console.log("Local User:", localUser);

    if (localUser) {
      console.log("Pharmacy ID:", localUser.pharmacyId?.toString());
      const pharmacy = await Pharmacy.findById(localUser.pharmacyId).lean();
      console.log("Pharmacy:", pharmacy);
    }
    
    const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));
    const branches = await Branch.find({ pharmacyId: localUser.pharmacyId }).lean();
    console.log("Branches in this pharmacy:", branches);
  } finally {
    process.exit(0);
  }
}

run();
