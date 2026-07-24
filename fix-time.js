const mongoose = require('mongoose');

async function fixTimezoneBug() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  // Get the Attendance model
  const Attendance = mongoose.model('Attendance', new mongoose.Schema({
    clockInTime: Date,
    clockOutTime: Date,
    date: String
  }, { strict: false }));

  // Find all attendances for today (2026-07-24)
  const attendances = await Attendance.find({ date: '2026-07-24' });
  
  let fixed = 0;
  for (const att of attendances) {
    let changed = false;
    
    if (att.clockInTime) {
      // Subtract 1 hour to fix the UTC bug
      att.clockInTime = new Date(att.clockInTime.getTime() - 60 * 60 * 1000);
      changed = true;
    }
    
    if (att.clockOutTime) {
      att.clockOutTime = new Date(att.clockOutTime.getTime() - 60 * 60 * 1000);
      changed = true;
    }

    if (changed) {
      await att.save();
      fixed++;
    }
  }

  console.log(`Fixed ${fixed} records.`);
  process.exit(0);
}

fixTimezoneBug();
