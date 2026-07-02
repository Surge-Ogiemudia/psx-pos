import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      pharmacyId: string;
      branchId: string;
      role: "admin" | "staff";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    pharmacyId: string;
    branchId: string;
    role: "admin" | "staff";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    pharmacyId?: string;
    branchId?: string;
    role?: "admin" | "staff";
  }
}
