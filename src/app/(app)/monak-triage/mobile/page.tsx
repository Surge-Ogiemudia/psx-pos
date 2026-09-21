import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import MonakTriageMobileClient from "./MonakTriageMobileClient";

export default async function MonakTriageMobilePage() {
  const session = await requirePageSession();
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakTriageMobileClient branchId={activeBranchId ?? ""} />;
}
