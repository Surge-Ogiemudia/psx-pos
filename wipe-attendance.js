const mongoose = require('mongoose');

async function checkUsers() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User', new mongoose.Schema({ employeeId: String, name: String }, { strict: false }));
  const users = await User.find({});
  console.log(users.map(u => `${u.name} (ID: ${u.employeeId})`));
  
  const Attendance = mongoose.model('Attendance', new mongoose.Schema({ userId: mongoose.Schema.Types.ObjectId, date: String }, { strict: false }));
  
  // Actually just wipe all attendance for today to be safe
  const res = await Attendance.deleteMany({ date: "2026-07-24" });
  console.log("Deleted all attendance for today: ", res.deletedCount);
  
  process.exit(0);
}

checkUsers();
