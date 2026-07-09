import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/seed.mjs");
  process.exit(1);
}

const PharmacySchema = new mongoose.Schema(
  {
    pharmacyName: String,
    logoUrl: String,
    brandColor: String,
    contactInfo: { email: String, phone: String, address: String },
  },
  { timestamps: true }
);
const BranchSchema = new mongoose.Schema(
  { pharmacyId: mongoose.Schema.Types.ObjectId, branchName: String, location: String },
  { timestamps: true }
);
const ProductSchema = new mongoose.Schema(
  {
    pharmacyId: mongoose.Schema.Types.ObjectId,
    branchId: mongoose.Schema.Types.ObjectId,
    itemName: String,
    brand: String,
    size: String,
    category: String,
    quantityInStock: Number,
    retailPrice: Number,
    wholesalePrice: Number,
    distributorPrice: Number,
    batchNumber: String,
    expiryDate: Date,
  },
  { timestamps: true }
);
const UserSchema = new mongoose.Schema(
  {
    pharmacyId: mongoose.Schema.Types.ObjectId,
    branchId: mongoose.Schema.Types.ObjectId,
    name: String,
    role: String,
    phoneNumber: String,
    passwordHash: String,
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

const Pharmacy = mongoose.model("Pharmacy", PharmacySchema);
const Branch = mongoose.model("Branch", BranchSchema);
const Product = mongoose.model("Product", ProductSchema);
const User = mongoose.model("User", UserSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const pharmacy = await Pharmacy.create({
    pharmacyName: "GoodHealth Pharmacy",
    logoUrl: "",
    brandColor: "#0f766e",
    contactInfo: { email: "contact@goodhealth.example", phone: "+1-555-0100", address: "12 Main St" },
  });
  console.log(`Created pharmacy: ${pharmacy.pharmacyName} (${pharmacy._id})`);

  const branch = await Branch.create({
    pharmacyId: pharmacy._id,
    branchName: "Main Branch",
    location: "12 Main St",
  });
  console.log(`Created branch: ${branch.branchName} (${branch._id})`);

  const adminPassword = "Admin1234!";
  const staffPassword = "Staff1234!";

  const admin = await User.create({
    pharmacyId: pharmacy._id,
    branchId: branch._id,
    name: "Ada Admin",
    role: "admin",
    phoneNumber: "+15550001",
    passwordHash: await bcrypt.hash(adminPassword, 12),
  });
  const staff = await User.create({
    pharmacyId: pharmacy._id,
    branchId: branch._id,
    name: "Sam Staff",
    role: "staff",
    phoneNumber: "+15550002",
    passwordHash: await bcrypt.hash(staffPassword, 12),
  });
  console.log(`Created admin user: ${admin.phoneNumber} / ${adminPassword}`);
  console.log(`Created staff user: ${staff.phoneNumber} / ${staffPassword}`);

  await Product.insertMany([
    {
      pharmacyId: pharmacy._id,
      branchId: branch._id,
      itemName: "Paracetamol",
      brand: "GSK",
      size: "500mg (20 tabs)",
      category: "medicine",
      quantityInStock: 120,
      retailPrice: 3.5,
      wholesalePrice: 2.75,
      distributorPrice: 2.0,
      batchNumber: "PCM-2026-01",
      expiryDate: new Date("2027-06-30"),
    },
    {
      pharmacyId: pharmacy._id,
      branchId: branch._id,
      itemName: "Amoxicillin",
      brand: "Pfizer",
      size: "250mg (10 caps)",
      category: "medicine",
      quantityInStock: 60,
      retailPrice: 6.0,
      wholesalePrice: 4.8,
      distributorPrice: 3.5,
      batchNumber: "AMX-2026-02",
      expiryDate: new Date("2027-03-15"),
    },
    {
      pharmacyId: pharmacy._id,
      branchId: branch._id,
      itemName: "Digital Thermometer",
      brand: "Omron",
      size: "Standard",
      category: "non-medicine",
      quantityInStock: 25,
      retailPrice: 12.0,
      wholesalePrice: 9.0,
      distributorPrice: 6.5,
      batchNumber: "",
      expiryDate: null,
    },
    {
      pharmacyId: pharmacy._id,
      branchId: branch._id,
      itemName: "Hand Sanitizer",
      brand: "Dettol",
      size: "250ml",
      category: "non-medicine",
      quantityInStock: 80,
      retailPrice: 4.25,
      wholesalePrice: 3.2,
      distributorPrice: 2.4,
      batchNumber: "",
      expiryDate: null,
    },
  ]);
  console.log("Seeded 4 sample products");

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
