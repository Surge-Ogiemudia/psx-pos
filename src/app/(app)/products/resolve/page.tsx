import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ResolveClient from "./ResolveClient";

export default async function ResolvePage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);

  return (
    <div className="min-h-screen bg-zinc-50 py-4">
      <ResolveClient branchId={activeBranchId} />
    </div>
  );
}
