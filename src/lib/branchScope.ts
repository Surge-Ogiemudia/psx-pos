import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { dbConnect } from "@/lib/mongodb";
import Branch from "@/models/Branch";

export interface BranchOption {
  _id: string;
  branchName: string;
}

/**
 * Admin has no fixed branch (pharmacy-wide), so which branch it's currently
 * "acting as" comes from a client-set cookie, validated against the pharmacy's
 * real branches. Staff always act as their own fixed branch.
 */
export async function resolveActiveBranch(
  session: Session
): Promise<{ activeBranchId: string | null; branches: BranchOption[] }> {
  if (session.user.role !== "admin") {
    return { activeBranchId: session.user.branchId, branches: [] };
  }

  await dbConnect();
  const branchDocs = await Branch.find({ pharmacyId: session.user.pharmacyId })
    .sort({ branchName: 1 })
    .lean();
  const branches: BranchOption[] = branchDocs.map((b) => ({
    _id: b._id.toString(),
    branchName: b.branchName,
  }));

  const cookieStore = await cookies();
  const cookieBranchId = cookieStore.get("activeBranchId")?.value ?? null;
  const isValid = cookieBranchId ? branches.some((b) => b._id === cookieBranchId) : false;

  return {
    activeBranchId: isValid ? cookieBranchId : (branches[0]?._id ?? null),
    branches,
  };
}
