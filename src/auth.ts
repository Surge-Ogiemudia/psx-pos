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

        await dbConnect();
        const user = await User.findOne({ phoneNumber });
        if (!user) throw new InvalidCredentialsError();

        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          throw new AccountLockedError();
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const attempts = user.failedLoginAttempts + 1;
          const locked = attempts >= MAX_FAILED_ATTEMPTS;
          await User.updateOne(
            { _id: user._id },
            {
              failedLoginAttempts: locked ? 0 : attempts,
              lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
            }
          );
          throw locked ? new AccountLockedError() : new InvalidCredentialsError();
        }

        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await User.updateOne(
            { _id: user._id },
            { failedLoginAttempts: 0, lockedUntil: null }
          );
        }

        return {
          id: user._id.toString(),
          name: user.name,
          pharmacyId: user.pharmacyId.toString(),
          branchId: user.branchId ? user.branchId.toString() : null,
          storeId: user.storeId ? user.storeId.toString() : null,
          role: user.role,
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
