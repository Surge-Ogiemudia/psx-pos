import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ActivityClient from "./ActivityClient";

export default async function ActivityPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  return <ActivityClient branchId={activeBranchId} />;
}
