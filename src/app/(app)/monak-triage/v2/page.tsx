import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import MonakTriageV2Client from "./MonakTriageV2Client";

const MONAK_PHARMACY_ID = "6a5f61da9e1719c3b02842ae";

export default async function MonakTriageV2Page() {
  const session = await requirePageSession();
  if (session.user.pharmacyId !== MONAK_PHARMACY_ID || session.user.role !== "admin") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <p className="rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
          Triage v2 is not available for your account yet.
        </p>
      </div>
    );
  }
  const { activeBranchId } = await resolveActiveBranch(session);

  return <MonakTriageV2Client branchId={activeBranchId ?? ""} />;
}
