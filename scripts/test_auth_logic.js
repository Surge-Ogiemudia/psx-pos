const mongoose = require('mongoose');
const fs = require('fs');

async function run() {
  try {
    const uri = fs.readFileSync('.env.local', 'utf8').match(/MONGODB_URI=(.*)/)[1];
    await mongoose.connect(uri);
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));

    const usersByPhone = await User.find({ phoneNumber: '09040006638' }).lean();
    console.log("Users with phone 09040006638:", usersByPhone);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
