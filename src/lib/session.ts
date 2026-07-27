import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

export async function getSsoSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Map Main PSX 'pharmacy' role to POS 'admin' role
    const mappedRole = decoded.role === 'pharmacy' ? 'admin' : decoded.role;

    return {
      user: {
        id: decoded.userId,
        name: decoded.name || 'User',
        pharmacyId: decoded.pharmacyId || decoded.userId, // fallback if pharmacyId isn't explicitly set
        branchId: decoded.branchId || null,
        storeId: decoded.storeId || null,
        role: mappedRole,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  } catch (error) {
    return null;
  }
}

export async function requirePageSession(): Promise<Session> {
  let session = await auth();
  if (!session?.user) {
    session = await getSsoSession();
  }
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireAdminPageSession(): Promise<Session> {
  const session = await requirePageSession();
  if (session.user.role !== "admin") redirect("/");
  return session;
}

export async function requireStorePageSession(): Promise<Session> {
  const session = await requirePageSession();
  if (!["admin", "store_manager", "store_keeper"].includes(session.user.role)) {
    redirect("/");
  }
  return session;
}

/** Retail pages (POS/Catalog/Reports) are for admin/staff — store-only roles belong on /store. */
export async function requireRetailPageSession(): Promise<Session> {
  const session = await requirePageSession();
  if (session.user.role === "store_manager" || session.user.role === "store_keeper") {
    redirect("/store");
  }
  return session;
}

export class ApiAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireApiSession(): Promise<Session> {
  let session = await auth();
  if (!session?.user) {
    session = await getSsoSession();
  }
  if (!session?.user) throw new ApiAuthError(401, "Not authenticated");
  return session;
}

export async function requireAdminApiSession(): Promise<Session> {
  const session = await requireApiSession();
  if (session.user.role !== "admin") throw new ApiAuthError(403, "Admin access required");
  return session;
}

export async function requireStoreApiSession(): Promise<Session> {
  const session = await requireApiSession();
  if (!["admin", "store_manager", "store_keeper"].includes(session.user.role)) {
    throw new ApiAuthError(403, "Store access required");
  }
  return session;
}

/**
 * Admin is pharmacy-wide and has no fixed branch, so it must pass the branch it's
 * acting on explicitly (query param or body). Staff stay locked to their own branch
 * regardless of what's requested, so a staff session can never be tricked into
 * reading/writing another branch's data.
 */
export function getBranchScope(
  session: Session,
  requestedBranchId?: string | null
): { pharmacyId: string; branchId: string } {
  if (session.user.role === "admin") {
    const branchId = requestedBranchId || session.user.branchId;
    if (!branchId) throw new ApiAuthError(400, "branchId is required");
    return { pharmacyId: session.user.pharmacyId, branchId };
  }
  const branchId = session.user.branchId || (requestedBranchId && requestedBranchId !== "null" ? requestedBranchId : null);
  if (!branchId) {
    throw new ApiAuthError(403, "No branch access");
  }
  return { pharmacyId: session.user.pharmacyId, branchId };
}

export function getStoreScope(
  session: Session,
  requestedStoreId?: string | null
): { pharmacyId: string; storeId: string } {
  if (session.user.role === "admin" || session.user.role === "store_manager") {
    if (!requestedStoreId) throw new ApiAuthError(400, "storeId is required");
    return { pharmacyId: session.user.pharmacyId, storeId: requestedStoreId };
  }
  if (session.user.role === "store_keeper") {
    if (!session.user.storeId) throw new ApiAuthError(403, "No store access");
    if (requestedStoreId && requestedStoreId !== session.user.storeId) {
      throw new ApiAuthError(403, "Cannot access another store");
    }
    return { pharmacyId: session.user.pharmacyId, storeId: session.user.storeId };
  }
  throw new ApiAuthError(403, "Store access required");
}
