import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import MonakTriageClient from "./MonakTriageClient";

export default async function MonakTriagePage() {
  const session = await requirePageSession();
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakTriageClient branchId={activeBranchId ?? ""} />;
}
