const mongoose = require('mongoose');

async function inspectProducts() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  const Pharmacy = mongoose.model('Pharmacy', new mongoose.Schema({}, { strict: false }));
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));
  const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));

  const pharmacies = await Pharmacy.find({}).lean();
  const branches = await Branch.find({}).lean();
  const products = await Product.find({}).lean();

  console.log(`Pharmacies: ${pharmacies.length}, Branches: ${branches.length}, Products: ${products.length}`);

  for (const ph of pharmacies) {
    const phBranches = branches.filter(b => b.pharmacyId.toString() === ph._id.toString());
    const phProducts = products.filter(p => p.pharmacyId && p.pharmacyId.toString() === ph._id.toString());
    
    const productsWithoutBranch = phProducts.filter(p => !p.branchId);
    const productsByBranch = {};
    for (const b of phBranches) {
      productsByBranch[b._id.toString()] = phProducts.filter(p => p.branchId && p.branchId.toString() === b._id.toString()).length;
    }

    console.log(`Pharmacy: ${ph.pharmacyName} (${ph._id})`);
    console.log(`  Branches (${phBranches.length}): ${phBranches.map(b => `${b.branchName} (${b._id})`).join(', ')}`);
    console.log(`  Total Products: ${phProducts.length}`);
    console.log(`  Products WITH NO branchId: ${productsWithoutBranch.length}`);
    console.log(`  Products by Branch:`, productsByBranch);

    // If there are products without branchId, assign them to the pharmacy's first branch!
    if (productsWithoutBranch.length > 0 && phBranches.length > 0) {
      const defaultBranchId = phBranches[0]._id;
      const res = await Product.updateMany(
        { pharmacyId: ph._id, $or: [{ branchId: null }, { branchId: { $exists: false } }] },
        { $set: { branchId: defaultBranchId } }
      );
      console.log(`  FIXED: Assigned ${res.modifiedCount} orphan products to branch ${phBranches[0].branchName} (${defaultBranchId})`);
    }
  }

  process.exit(0);
}

inspectProducts();
