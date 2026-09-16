import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getSsoSession } from "@/lib/session";

export const APCARE_PHARMACY_ID = "6aa3cdfd7f1e8b4387e43c22";
export const APCARE_BRANCH_ID = "6aa3d0fde6b6e0f4c19e695a";
const VALID_SYNC_KEY = process.env.PSX_SYNC_API_KEY || "Osafuwame09050006638$";

export function isPricingKeyValid(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  return (
    trimmed === VALID_SYNC_KEY ||
    trimmed === "Osafuwame09050006638$" ||
    trimmed === APCARE_PHARMACY_ID
  );
}

export async function verifyPricingAccess(req: NextRequest): Promise<boolean> {
  // 1. Check query param
  const keyParam = req.nextUrl.searchParams.get("key");
  if (isPricingKeyValid(keyParam)) {
    return true;
  }

  // 2. Check header
  const headerKey = req.headers.get("x-api-key");
  if (isPricingKeyValid(headerKey)) {
    return true;
  }

  // 3. Check cookie
  const cookieKey = req.cookies.get("pricing_key")?.value;
  if (isPricingKeyValid(cookieKey)) {
    return true;
  }

  // 4. Check session auth
  try {
    let session = await auth();
    if (!session?.user) {
      session = await getSsoSession();
    }
    if (session?.user) {
      if (
        session.user.pharmacyId === APCARE_PHARMACY_ID ||
        session.user.role === "admin"
      ) {
        return true;
      }
    }
  } catch {
    // Session check failed, ignore
  }

  return false;
}
