const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Read env
let env = '';
try {
  env = fs.readFileSync('.env.local', 'utf8');
} catch (e) {
  console.log("No .env.local found");
  process.exit(1);
}
const mongoUri = env.match(/MONGODB_URI=["']?(.*?)["']?(\n|$)/)[1];

// Define schemas to avoid importing Next.js TS models
const pharmacySchema = new mongoose.Schema({
  pharmacyName: String,
  slug: String,
  logoUrl: String,
  brandColor: String,
});
const Pharmacy = mongoose.models.Pharmacy || mongoose.model('Pharmacy', pharmacySchema);

const userSchema = new mongoose.Schema({
  pharmacyId: mongoose.Schema.Types.ObjectId,
  branchId: mongoose.Schema.Types.ObjectId,
  storeId: mongoose.Schema.Types.ObjectId,
  name: String,
  role: String,
  phoneNumber: String,
  passwordHash: String,
  failedLoginAttempts: Number,
  lockedUntil: Date,
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

const branchSchema = new mongoose.Schema({
  pharmacyId: mongoose.Schema.Types.ObjectId,
  branchName: String,
});
const Branch = mongoose.models.Branch || mongoose.model('Branch', branchSchema);

const storeSchema = new mongoose.Schema({
  pharmacyId: mongoose.Schema.Types.ObjectId,
  storeName: String,
});
const Store = mongoose.models.Store || mongoose.model('Store', storeSchema);

async function run() {
  if (!mongoUri) throw new Error("No MONGODB_URI");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  // Check if pharmacy exists
  let pharmacy = await Pharmacy.findOne({ slug: "medlife" });
  if (!pharmacy) {
    pharmacy = await Pharmacy.create({
      pharmacyName: "Medlife Pharmacy",
      slug: "medlife",
      logoUrl: "",
      brandColor: "#0f766e"
    });
    console.log("Created Pharmacy: Medlife Pharmacy");
  } else {
    console.log("Pharmacy 'medlife' already exists.");
  }

  // Create default branch
  let branch = await Branch.findOne({ pharmacyId: pharmacy._id, branchName: "Main Branch" });
  if (!branch) {
    branch = await Branch.create({
      pharmacyId: pharmacy._id,
      branchName: "Main Branch"
    });
    console.log("Created Branch: Main Branch");
  }

  // Create default store
  let store = await Store.findOne({ pharmacyId: pharmacy._id, storeName: "Central Warehouse" });
  if (!store) {
    store = await Store.create({
      pharmacyId: pharmacy._id,
      storeName: "Central Warehouse"
    });
    console.log("Created Store: Central Warehouse");
  }

  // Create Admin
  const adminPhone = "08000000000";
  let admin = await User.findOne({ phoneNumber: adminPhone });
  if (!admin) {
    const passwordHash = await bcrypt.hash("password123", 12);
    admin = await User.create({
      pharmacyId: pharmacy._id,
      name: "Medlife Admin",
      role: "admin",
      phoneNumber: adminPhone,
      passwordHash: passwordHash,
      failedLoginAttempts: 0
    });
    console.log("Created Admin user: " + adminPhone + " / password123");
  } else {
    console.log("Admin user with " + adminPhone + " already exists.");
  }

  console.log("Seeding complete!");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
