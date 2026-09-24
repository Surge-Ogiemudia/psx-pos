import type { Session } from "next-auth";
import { ApiAuthError, requireApiSession } from "@/lib/session";

// Owner decision: while false, only pharmacy admins may use Triage v2. Flip to true when it
// goes live so ANY operator (branch staff) may merge.
export const TRIAGE_V2_OPEN_TO_ALL_OPERATORS = false;

export const TRIAGE_V2_PHARMACY_ID = "6a5f61da9e1719c3b02842ae"; // Monak Pharmacy

export async function requireTriageV2Session(): Promise<Session> {
  const session = await requireApiSession();
  if (String(session.user.pharmacyId) !== TRIAGE_V2_PHARMACY_ID) {
    throw new ApiAuthError(403, "Triage v2 is not available for this pharmacy");
  }
  if (!TRIAGE_V2_OPEN_TO_ALL_OPERATORS && session.user.role !== "admin") {
    throw new ApiAuthError(403, "Admin access required");
  }
  return session;
}
