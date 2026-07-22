import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { dbConnect } from "@/lib/mongodb";
import User from "@/models/User";
import { getMainPsxUrl } from "@/lib/mainPsx";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

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
        ssoToken: { label: "SSO Token", type: "text" },
        phoneNumber: { label: "Phone number", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // SSO Token authentication path (used by Terminal iframe bridge)
        if (credentials?.ssoToken) {
          try {
            const decoded = jwt.verify(String(credentials.ssoToken), JWT_SECRET) as {
              userId: string;
              role: string;
              email?: string;
              pharmacyId?: string;
              name?: string;
              businessName?: string;
            };

            await dbConnect();

            const mappedRole = decoded.role === 'pharmacy' ? 'admin' : decoded.role;
            let finalPharmacyId = decoded.role === 'pharmacy' ? decoded.userId : (decoded.pharmacyId || decoded.userId);
            let finalBranchId: string | null = null;
            let finalStoreId: string | null = null;
            let finalName = decoded.name || decoded.email || 'User';

            if (decoded.role !== 'pharmacy') {
              const localUser = await User.findById(decoded.userId).lean();
              if (localUser) {
                finalPharmacyId = localUser.pharmacyId?.toString() || finalPharmacyId;
                finalBranchId = localUser.branchId?.toString() || null;
                finalStoreId = localUser.storeId?.toString() || null;
                if (localUser.name) finalName = localUser.name;
              }
            }

            // Lazy provision pharmacy, branch, store
            if (finalPharmacyId) {
              let pharmacy = await Pharmacy.findById(finalPharmacyId);
              if (!pharmacy) {
                pharmacy = await Pharmacy.create({
                  _id: finalPharmacyId,
                  pharmacyName: decoded.businessName || "My Pharmacy",
                  slug: finalPharmacyId.slice(-6),
                });
              } else if (pharmacy.pharmacyName === "My Pharmacy" || pharmacy.pharmacyName === "Pharmacy") {
                // If it was previously borked due to SSO without businessName, fix it
                if (decoded.businessName) {
                  pharmacy.pharmacyName = decoded.businessName;
                  await pharmacy.save();
                }
              }

              // Only lazily provision branches/stores if admin is logging in
              if (decoded.role === 'pharmacy') {
                let branch = await Branch.findOne({ pharmacyId: finalPharmacyId });
                if (!branch) {
                  branch = await Branch.create({
                    pharmacyId: finalPharmacyId,
                    branchName: 'Main Branch',
                    location: 'Headquarters',
                  });
                }
                let store = await Store.findOne({ pharmacyId: finalPharmacyId });
                if (!store) {
                  store = await Store.create({
                    pharmacyId: finalPharmacyId,
                    storeName: 'Main Bulk Store',
                    location: 'Headquarters',
                  });
                }
              }
            }

            return {
              id: decoded.userId,
              name: finalName,
              pharmacyId: finalPharmacyId,
              branchId: finalBranchId,
              storeId: finalStoreId,
              role: mappedRole,
            };
          } catch {
            throw new InvalidCredentialsError();
          }
        }

        const phoneNumber = String(credentials?.phoneNumber ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!phoneNumber || !password) throw new InvalidCredentialsError();

        // 1. Authenticate against Main PSX
        const mainPsxUrl = getMainPsxUrl();
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

        let finalPharmacyId = user.role === 'pharmacy' ? user.id : user.pharmacyId;
        let finalBranchId = user.branchId || null;
        let finalStoreId = user.storeId || null;

        if (user.role !== 'pharmacy') {
          const User = (await import('@/models/User')).default;
          const localUser = await User.findById(user.id).lean();
          if (localUser) {
            finalPharmacyId = localUser.pharmacyId?.toString() || finalPharmacyId;
            finalBranchId = localUser.branchId?.toString() || finalBranchId;
            finalStoreId = localUser.storeId?.toString() || finalStoreId;
          }
        }

        return {
          id: user.id,
          name: user.name,
          pharmacyId: finalPharmacyId,
          branchId: finalBranchId,
          storeId: finalStoreId,
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
