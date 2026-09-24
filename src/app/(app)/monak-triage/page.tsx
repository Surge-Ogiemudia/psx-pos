import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import { isMonakTriageLocked } from "@/lib/monakTriageLock";
import MonakTriageLocked from "./MonakTriageLocked";
import MonakTriageClient from "./MonakTriageClient";

export default async function MonakTriagePage() {
  const session = await requirePageSession();
  if (isMonakTriageLocked(session.user.pharmacyId)) return <MonakTriageLocked />;
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakTriageClient branchId={activeBranchId ?? ""} />;
}
