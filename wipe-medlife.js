const mongoose = require('mongoose');

async function wipeMedlife() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB for wiping Medlife...");

  const Pharmacy = mongoose.model('Pharmacy', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({ pharmacyId: mongoose.Schema.Types.ObjectId }, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({ pharmacyId: mongoose.Schema.Types.ObjectId }, { strict: false }));
  const BiometricDevice = mongoose.model('BiometricDevice', new mongoose.Schema({ pharmacyId: mongoose.Schema.Types.ObjectId }, { strict: false }));

  // Find all pharmacies matching "medlife"
  const pharmacies = await Pharmacy.find({ name: new RegExp('medlife', 'i') });
  console.log(`Found ${pharmacies.length} pharmacies matching 'medlife'.`);

  for (const ph of pharmacies) {
    console.log(`Wiping data for Pharmacy: ${ph.name} (${ph._id})`);
    
    // Delete branches
    const branchRes = await Branch.deleteMany({ pharmacyId: ph._id });
    console.log(`- Deleted ${branchRes.deletedCount} branches.`);

    // Delete users
    const userRes = await User.deleteMany({ pharmacyId: ph._id });
    console.log(`- Deleted ${userRes.deletedCount} users.`);

    // Delete devices
    const devRes = await BiometricDevice.deleteMany({ pharmacyId: ph._id });
    console.log(`- Deleted ${devRes.deletedCount} biometric devices.`);

    // Delete the pharmacy itself
    await Pharmacy.deleteOne({ _id: ph._id });
    console.log(`- Deleted pharmacy ${ph.name}.`);
  }

  // Also specifically wipe any users matching "medlife" or phone "08106292804" just in case they are orphaned
  const orphanUserRes = await User.deleteMany({
    $or: [
      { phone: '08106292804' },
      { phoneNumber: '08106292804' },
      { name: new RegExp('medlife', 'i') }
    ]
  });
  if (orphanUserRes.deletedCount > 0) {
    console.log(`Deleted ${orphanUserRes.deletedCount} orphan Medlife users or users with phone 08106292804.`);
  }

  // Find any orphan pharmacies named medlife just in case
  const orphanPharmRes = await Pharmacy.deleteMany({ name: new RegExp('medlife', 'i') });
  if (orphanPharmRes.deletedCount > 0) {
    console.log(`Deleted ${orphanPharmRes.deletedCount} orphan Medlife pharmacies.`);
  }

  console.log("Wipe complete!");
  process.exit(0);
}

wipeMedlife();
