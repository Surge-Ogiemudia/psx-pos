import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import { isMonakTriageLocked } from "@/lib/monakTriageLock";
import MonakTriageLocked from "../MonakTriageLocked";
import MonakTriageMobileClient from "./MonakTriageMobileClient";

export default async function MonakTriageMobilePage() {
  const session = await requirePageSession();
  if (isMonakTriageLocked(session.user.pharmacyId)) return <MonakTriageLocked />;
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakTriageMobileClient branchId={activeBranchId ?? ""} />;
}
