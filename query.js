const mongoose = require('mongoose');

async function queryDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  // Check Pharmacy collection
  const Pharmacy = mongoose.model('Pharmacy', new mongoose.Schema({}, { strict: false }));
  // Check User collection
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  const searchParam = "08106292804";

  // Search pharmacies by phone or name or any field that might match
  const pharmacies = await Pharmacy.find({ 
    $or: [
      { phone: new RegExp(searchParam, 'i') },
      { contactPhone: new RegExp(searchParam, 'i') },
      { pharmacyPhone: new RegExp(searchParam, 'i') },
      { name: new RegExp(searchParam, 'i') }
    ]
  });

  console.log(`Found ${pharmacies.length} pharmacies matching ${searchParam}:`);
  pharmacies.forEach(p => console.log(`- Pharmacy: ${p.name}, Phone: ${p.phone || p.contactPhone || p.pharmacyPhone}`));

  // Search users by phone
  const users = await User.find({
    $or: [
      { phone: new RegExp(searchParam, 'i') },
      { phoneNumber: new RegExp(searchParam, 'i') },
      { name: new RegExp(searchParam, 'i') },
      { email: new RegExp(searchParam, 'i') }
    ]
  });

  console.log(`Found ${users.length} users matching ${searchParam}:`);
  users.forEach(u => console.log(`- User: ${u.name}, Phone: ${u.phone || u.phoneNumber}, Email: ${u.email}`));

  process.exit(0);
}

queryDB();
