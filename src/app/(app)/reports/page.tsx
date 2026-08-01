import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ReportsClient from "./ReportsClient";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";

export default async function ReportsPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  
  await dbConnect();
  const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();
  let branchName = "";
  let branchAddress = "";
  
  if (activeBranchId) {
    const branch = await Branch.findById(activeBranchId).lean();
    if (branch) {
      branchName = branch.branchName;
      branchAddress = branch.location || "";
    }
  }

  return (
    <ReportsClient 
      branchId={activeBranchId} 
      pharmacyName={pharmacy?.pharmacyName || "Pharmacy"}
      branchName={branchName}
      branchAddress={branchAddress}
      staffName={session.user.name || undefined}
    />
  );
}
