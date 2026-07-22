const mongoose = require('mongoose');
const fs = require('fs');

async function run() {
  try {
    const uri = fs.readFileSync('.env.local', 'utf8').match(/MONGODB_URI=(.*)/)[1];
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    
    const users = await User.find({ phoneNumber: / $/ });
    for (const u of users) {
      console.log(`Fixing user: ${u.name}, phone: '${u.phoneNumber}'`);
      await User.updateOne({ _id: u._id }, { $set: { phoneNumber: u.phoneNumber.trim() } });
    }
    console.log(`Fixed ${users.length} POS users`);
    
    // Also try to fix Main PSX DB if we have access (the pos database URL might be the same cluster)
    // Actually they might be the same database cluster just different database names!
    // Let's assume Main PSX is 'psx-emr' database or we can just ask the user to recreate the staff.
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
