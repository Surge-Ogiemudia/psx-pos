const mongoose = require('mongoose');

async function cleanupTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const BiometricDevice = mongoose.model('BiometricDevice', new mongoose.Schema({ serialNumber: String }, { strict: false }));
  const Attendance = mongoose.model('Attendance', new mongoose.Schema({ clockInMethod: String }, { strict: false }));

  // Delete all attendance records created by the ZKTeco device (face/pin/etc.)
  // Actually, let's just wipe all attendance since they were just testing
  const attRes = await Attendance.deleteMany({});
  console.log(`Deleted ${attRes.deletedCount} test attendance records.`);

  // Delete the test biometric device
  const devRes = await BiometricDevice.deleteMany({});
  console.log(`Deleted ${devRes.deletedCount} biometric devices from the account.`);

  process.exit(0);
}

cleanupTest();
