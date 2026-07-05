import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  return <ReportsClient branchId={activeBranchId} />;
}
