"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginClient({
  brandName,
  logoUrl,
  brandColor,
}: {
  brandName: string;
  logoUrl?: string;
  brandColor?: string;
}) {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      phoneNumber,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError(
        result.code === "account-locked"
          ? "Account locked due to repeated failed attempts. Try again in 15 minutes."
          : "Invalid phone number or password."
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary per-pharmacy URL, not a known/configured domain
          <img src={logoUrl} alt="" className="mb-3 h-10 w-auto object-contain" />
        )}
        <h1 className="mb-1 text-xl font-semibold text-zinc-900">{brandName}</h1>
        <p className="mb-6 text-sm text-zinc-500">Sign in to your pharmacy account</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="phoneNumber" className="mb-1 block text-sm font-medium text-zinc-700">
              Phone number
            </label>
            <input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              autoComplete="username"
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 pr-10 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-600"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" />
                    <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                    <path
                      fillRule="evenodd"
                      d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.147.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            style={brandColor ? { backgroundColor: brandColor } : undefined}
            className={`mt-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
              brandColor ? "hover:opacity-90" : "bg-teal-700 hover:bg-teal-800"
            }`}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
