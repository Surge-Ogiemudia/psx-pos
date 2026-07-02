import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";

export async function requirePageSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireAdminPageSession(): Promise<Session> {
  const session = await requirePageSession();
  if (session.user.role !== "admin") redirect("/");
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
  const session = await auth();
  if (!session?.user) throw new ApiAuthError(401, "Not authenticated");
  return session;
}

export async function requireAdminApiSession(): Promise<Session> {
  const session = await requireApiSession();
  if (session.user.role !== "admin") throw new ApiAuthError(403, "Admin access required");
  return session;
}
