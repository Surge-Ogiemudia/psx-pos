import { redirect } from "next/navigation";
import { requireCatalogPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";
import ReceiptsClient from "./ReceiptsClient";

export default async function ReceiptsPage() {
  const session = await requireCatalogPageSession();
  if (session.user.role !== "admin" && session.user.role !== "store_keeper") redirect("/pos");
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
    <ReceiptsClient
      branchId={activeBranchId}
      pharmacyName={pharmacy?.pharmacyName || "Pharmacy"}
      branchName={branchName}
      branchAddress={branchAddress}
    />
  );
}
