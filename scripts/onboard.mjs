import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Run with: node --env-file=.env.local scripts/onboard.mjs [options]");
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function usageAndExit(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    `Usage: node --env-file=.env.local scripts/onboard.mjs \\
    --pharmacy "City Pharmacy" \\
    --branch "Main Branch" \\
    --admin-name "Jane Doe" \\
    --admin-phone "+2348011112222" \\
    [--admin-password "..."]        (generated and printed if omitted)
    [--slug "city-pharmacy"]         (subdomain, e.g. city-pharmacy.pos.psx.ng — derived from
                                      --pharmacy if omitted)
    [--color "#1d4ed8"]              (brand color, hex)
    [--logo "https://.../logo.png"]  (logo URL)
    [--email "info@pharmacy.com"]
    [--phone "+2348012345678"]       (pharmacy contact phone)
    [--address "10 Broad St, Lagos"]
    [--location "10 Broad St, Lagos"] (branch location, defaults to --address)
    [--store "Main Bulk Store"]      (also creates a bulk store, optional)`
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const pharmacyName = typeof args.pharmacy === "string" ? args.pharmacy.trim() : "";
const branchName = typeof args.branch === "string" ? args.branch.trim() : "";
const adminName = typeof args["admin-name"] === "string" ? args["admin-name"].trim() : "";
const adminPhone = typeof args["admin-phone"] === "string" ? args["admin-phone"].trim() : "";

if (!pharmacyName) usageAndExit("--pharmacy is required");
if (!branchName) usageAndExit("--branch is required");
if (!adminName) usageAndExit("--admin-name is required");
if (!adminPhone) usageAndExit("--admin-phone is required");

const adminPassword =
  typeof args["admin-password"] === "string" ? args["admin-password"] : crypto.randomBytes(9).toString("base64url");

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const slug = typeof args.slug === "string" ? slugify(args.slug) : slugify(pharmacyName);
if (!slug) usageAndExit("Could not derive a usable --slug from the pharmacy name — pass --slug explicitly");

const brandColor = typeof args.color === "string" ? args.color : "#0f766e";
const logoUrl = typeof args.logo === "string" ? args.logo : "";
const email = typeof args.email === "string" ? args.email : "";
const phone = typeof args.phone === "string" ? args.phone : "";
const address = typeof args.address === "string" ? args.address : "";
const location = typeof args.location === "string" ? args.location : address;
const storeName = typeof args.store === "string" ? args.store.trim() : "";

const PharmacySchema = new mongoose.Schema(
  {
    pharmacyName: String,
    slug: { type: String, unique: true },
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
const StoreSchema = new mongoose.Schema(
  { pharmacyId: mongoose.Schema.Types.ObjectId, storeName: String, location: String },
  { timestamps: true }
);
const UserSchema = new mongoose.Schema(
  {
    pharmacyId: mongoose.Schema.Types.ObjectId,
    branchId: { type: mongoose.Schema.Types.ObjectId, default: null },
    storeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: String,
    role: String,
    phoneNumber: { type: String, unique: true },
    passwordHash: String,
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

const Pharmacy = mongoose.model("Pharmacy", PharmacySchema);
const Branch = mongoose.model("Branch", BranchSchema);
const Store = mongoose.model("Store", StoreSchema);
const User = mongoose.model("User", UserSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const existing = await User.findOne({ phoneNumber: adminPhone });
  if (existing) {
    throw new Error(`A user with phone number ${adminPhone} already exists (phone numbers must be globally unique).`);
  }
  const existingSlug = await Pharmacy.findOne({ slug });
  if (existingSlug) {
    throw new Error(`Slug "${slug}" is already taken by "${existingSlug.pharmacyName}" — pass --slug with a different value.`);
  }

  const pharmacy = await Pharmacy.create({
    pharmacyName,
    slug,
    logoUrl,
    brandColor,
    contactInfo: { email, phone, address },
  });
  console.log(`Created pharmacy: ${pharmacy.pharmacyName} (${pharmacy._id}), slug "${pharmacy.slug}"`);

  const branch = await Branch.create({
    pharmacyId: pharmacy._id,
    branchName,
    location,
  });
  console.log(`Created branch: ${branch.branchName} (${branch._id})`);

  if (storeName) {
    const store = await Store.create({ pharmacyId: pharmacy._id, storeName, location });
    console.log(`Created store: ${store.storeName} (${store._id})`);
  }

  // Admin is pharmacy-wide (not tied to one branch), so no branchId here.
  const admin = await User.create({
    pharmacyId: pharmacy._id,
    name: adminName,
    role: "admin",
    phoneNumber: adminPhone,
    passwordHash: await bcrypt.hash(adminPassword, 12),
  });

  console.log("\nOnboarding complete. Admin login:");
  console.log(`  URL:      https://${pharmacy.slug}.pos.psx.ng`);
  console.log(`  Phone:    ${admin.phoneNumber}`);
  console.log(`  Password: ${adminPassword}`);
  console.log("\nShare these credentials with the pharmacy admin and have them sign in and add their own products and staff.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
