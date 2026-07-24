import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/add-device.mjs");
  process.exit(1);
}

// Schemas needed
const PharmacySchema = new mongoose.Schema({ pharmacyName: String });
const BranchSchema = new mongoose.Schema({ pharmacyId: mongoose.Schema.Types.ObjectId, branchName: String });
const UserSchema = new mongoose.Schema({ 
    pharmacyId: mongoose.Schema.Types.ObjectId, 
    branchId: mongoose.Schema.Types.ObjectId, 
    phoneNumber: String 
});
const BiometricDeviceSchema = new mongoose.Schema(
  {
    pharmacyId: mongoose.Schema.Types.ObjectId,
    branchId: mongoose.Schema.Types.ObjectId,
    serialNumber: String,
    name: String,
    lastSeen: Date,
  },
  { timestamps: true }
);

const Pharmacy = mongoose.model("Pharmacy", PharmacySchema);
const Branch = mongoose.model("Branch", BranchSchema);
const User = mongoose.model("User", UserSchema);
const BiometricDevice = mongoose.model("BiometricDevice", BiometricDeviceSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Find pharmacy by name
  const pharmacy = await Pharmacy.findOne({ pharmacyName: { $regex: /monak/i } });
  if (!pharmacy) {
    console.error("Pharmacy matching 'monak' not found!");
    process.exit(1);
  }
  console.log(`Found pharmacy! Pharmacy ID: ${pharmacy._id}`);

  // Find branch by name and pharmacyId
  const branch = await Branch.findOne({ 
    pharmacyId: pharmacy._id, 
    branchName: { $regex: /santana/i } 
  });
  
  if (!branch) {
      console.error("Could not find a branch matching 'santana'.");
      process.exit(1);
  }
  console.log(`Found branch! Branch ID: ${branch._id}`);

  const serialNumber = "TTQ5254800191";

  // Check if device already exists
  const existingDevice = await BiometricDevice.findOne({ serialNumber });
  if (existingDevice) {
      console.log(`Device ${serialNumber} already exists in DB!`);
  } else {
      await BiometricDevice.create({
          pharmacyId: pharmacy._id,
          branchId: branch._id,
          serialNumber: serialNumber,
          name: "Santana Main Branch ZKTeco",
      });
      console.log(`Successfully registered ZKTeco device ${serialNumber} to ${branch.branchName}!`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
