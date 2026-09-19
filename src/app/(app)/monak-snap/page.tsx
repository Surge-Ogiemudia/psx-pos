import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import MonakSnapClient from "./MonakSnapClient";

export default async function MonakSnapPage() {
  const session = await requirePageSession();
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakSnapClient branchId={activeBranchId ?? ""} />;
}
