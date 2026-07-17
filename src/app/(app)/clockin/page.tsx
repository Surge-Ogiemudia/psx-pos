import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ClockInClient from "./ClockInClient";

export default async function ClockInPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  return <ClockInClient branchId={activeBranchId} />;
}
