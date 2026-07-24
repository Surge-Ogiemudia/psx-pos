import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

const PharmacySchema = new mongoose.Schema({ pharmacyName: String });
const BranchSchema = new mongoose.Schema({ pharmacyId: mongoose.Schema.Types.ObjectId, branchName: String });
const UserSchema = new mongoose.Schema({ 
    pharmacyId: mongoose.Schema.Types.ObjectId, 
    branchId: mongoose.Schema.Types.ObjectId, 
    name: String,
    phoneNumber: String,
    role: String,
    passwordHash: String,
    employeeId: String,
    status: String,
    failedLoginAttempts: { type: Number, default: 0 },
});

const Pharmacy = mongoose.model("Pharmacy", PharmacySchema);
const Branch = mongoose.model("Branch", BranchSchema);
const User = mongoose.model("User", UserSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Find pharmacy
  const pharmacy = await Pharmacy.findOne({ pharmacyName: { $regex: /monak/i } });
  if (!pharmacy) {
    console.error("Pharmacy matching 'monak' not found!");
    process.exit(1);
  }

  // Find branch
  const branch = await Branch.findOne({ 
    pharmacyId: pharmacy._id, 
    branchName: { $regex: /santana/i } 
  });
  
  if (!branch) {
      console.error("Could not find a branch matching 'santana'.");
      process.exit(1);
  }

  const userPhone = "+234000000000";
  const userPassword = "Password123!";

  // Check if user already exists
  const existingUser = await User.findOne({ phoneNumber: userPhone });
  if (existingUser) {
      // Just update employeeId
      existingUser.employeeId = "1";
      await existingUser.save();
      console.log(`Updated existing test user ${userPhone} with employeeId: 1`);
  } else {
      await User.create({
          pharmacyId: pharmacy._id,
          branchId: branch._id,
          name: "ZKTeco Test Staff",
          phoneNumber: userPhone,
          role: "staff",
          passwordHash: await bcrypt.hash(userPassword, 12),
          employeeId: "1",
          status: "active",
      });
      console.log(`Successfully created test user "ZKTeco Test Staff"!`);
      console.log(`Phone: ${userPhone}`);
      console.log(`Password: ${userPassword}`);
      console.log(`Device ID: 1`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
