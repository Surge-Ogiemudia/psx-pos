import { requireAdminPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import StaffClient from "./StaffClient";

export default async function StaffPage() {
  const session = await requireAdminPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  return <StaffClient branchId={activeBranchId} userRole={session.user.role} />;
}
