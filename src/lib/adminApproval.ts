import jwt from "jsonwebtoken";

// Short-lived proof that an admin typed their password to approve ONE product edit by a staff
// member. Signed with AUTH_SECRET (never the "changeme" fallback used elsewhere), scoped to a
// pharmacy + product, and useless for anything else.
const PURPOSE = "product-edit-approval";
const TTL_SECONDS = 10 * 60;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export interface ApprovalClaims {
  adminId: string;
  adminName: string;
  pharmacyId: string;
  productId: string;
}

export function signEditApproval(claims: ApprovalClaims): string {
  return jwt.sign({ purpose: PURPOSE, ...claims }, secret(), { expiresIn: TTL_SECONDS });
}

export function verifyEditApproval(
  token: string | null | undefined,
  expected: { pharmacyId: string; productId: string }
): ApprovalClaims | null {
  if (!token) return null;
  try {
    const d = jwt.verify(token, secret()) as Partial<ApprovalClaims> & { purpose?: string };
    if (d.purpose !== PURPOSE) return null;
    if (d.pharmacyId !== expected.pharmacyId || d.productId !== expected.productId) return null;
    if (!d.adminId) return null;
    return { adminId: d.adminId, adminName: d.adminName ?? "Admin", pharmacyId: d.pharmacyId, productId: d.productId };
  } catch {
    return null;
  }
}
