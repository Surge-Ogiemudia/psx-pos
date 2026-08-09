import { requireRetailPageSession } from "@/lib/session";
import dynamic from "next/dynamic";
import { resolveActiveBranch } from "@/lib/branchScope";

const PosClient = dynamic(() => import("./PosClient"), { ssr: false });
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";

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
      branchName = branch.branchName;
      branchAddress = branch.location || "";
    }
  }

  return (
    <PosClient 
      branchId={activeBranchId} 
      pharmacyId={session.user.pharmacyId} 
      pharmacyName={pharmacy?.pharmacyName || "Pharmacy"}
      branchName={branchName}
      branchAddress={branchAddress}
      staffName={session.user.name || undefined}
    />
  );
}
