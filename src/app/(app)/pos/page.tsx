import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import PosClient from "./PosClient";
import { dbConnect } from "@/lib/mongodb";
import { Pharmacy } from "@/models/Pharmacy";
import { Branch } from "@/models/Branch";

export default async function PosPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  
  await dbConnect();
  const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();
  let branchName = "";
  let branchAddress = "";
  
  if (activeBranchId) {
    const branch = await Branch.findById(activeBranchId).lean();
    if (branch) {
      branchName = branch.name;
      branchAddress = branch.address || "";
    }
  }

  return (
    <PosClient 
      branchId={activeBranchId} 
      pharmacyId={session.user.pharmacyId} 
      pharmacyName={pharmacy?.name || "Pharmacy"}
      branchName={branchName}
      branchAddress={branchAddress}
      staffName={session.user.name}
    />
  );
}
