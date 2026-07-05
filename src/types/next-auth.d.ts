import type { DefaultSession } from "next-auth";

export type UserRole = "admin" | "staff" | "store_manager" | "store_keeper";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      pharmacyId: string;
      branchId: string | null;
      storeId: string | null;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    pharmacyId: string;
    branchId: string | null;
    storeId: string | null;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    pharmacyId?: string;
    branchId?: string | null;
    storeId?: string | null;
    role?: UserRole;
  }
}
