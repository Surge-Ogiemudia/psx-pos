import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid-credentials";
}

class AccountLockedError extends CredentialsSignin {
  code = "account-locked";
}

import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";
import Store from "@/models/Store";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        phoneNumber: { label: "Phone number", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const phoneNumber = String(credentials?.phoneNumber ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!phoneNumber || !password) throw new InvalidCredentialsError();

        // 1. Authenticate against Main PSX
        const mainPsxUrl = process.env.NODE_ENV === 'production' ? 'https://www.psx.ng' : 'http://localhost:3000';
        const loginRes = await fetch(`${mainPsxUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber, password })
        });

        if (!loginRes.ok) {
          throw new InvalidCredentialsError();
        }

        const data = await loginRes.json();
        const user = data.user;

        if (!user || !user.id) throw new InvalidCredentialsError();

        await dbConnect();

        // 2. Lazy Provisioning for Pharmacy Role
        if (user.role === 'pharmacy') {
          let pharmacy = await Pharmacy.findById(user.id);
          if (!pharmacy) {
            pharmacy = await Pharmacy.create({
              _id: user.id,
              pharmacyName: user.businessName || user.name || "My Pharmacy",
              slug: user.slug || user.id.slice(-6),
            });
          }
          
          let branch = await Branch.findOne({ pharmacyId: user.id });
          if (!branch) {
            branch = await Branch.create({
              pharmacyId: user.id,
              branchName: 'Main Branch',
              location: 'Headquarters',
            });
          }

          let store = await Store.findOne({ pharmacyId: user.id });
          if (!store) {
            store = await Store.create({
              pharmacyId: user.id,
              storeName: 'Main Bulk Store',
              location: 'Headquarters',
            });
          }
        }

        const mappedRole = user.role === 'pharmacy' ? 'admin' : user.role;

        return {
          id: user.id,
          name: user.name,
          pharmacyId: user.pharmacyId,
          branchId: null, // Depending on staff config this might need fetching, but for admin it's null
          storeId: null,
          role: mappedRole,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.pharmacyId = user.pharmacyId;
        token.branchId = user.branchId;
        token.storeId = user.storeId;
        token.role = user.role;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.pharmacyId = token.pharmacyId as string;
      session.user.branchId = (token.branchId as string | null) ?? null;
      session.user.storeId = (token.storeId as string | null) ?? null;
      session.user.role = token.role as "admin" | "staff" | "store_manager" | "store_keeper";
      session.user.name = token.name as string;
      return session;
    },
  },
});
