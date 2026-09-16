import { Suspense } from "react";
import PricingReviewClient from "./PricingReviewClient";

export const metadata = {
  title: "MD Pricing Wizard | APCare Pharmacy",
  description: "Mobile-first catalog pricing review for APCare Pharmacy",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
};

export default async function PricingReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const params = await searchParams;
  const initialKey = params?.key || "";

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
          <div className="text-center px-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent mx-auto mb-4"></div>
            <h2 className="text-lg font-bold text-zinc-100">Loading Pricing Wizard</h2>
            <p className="text-sm text-zinc-400 mt-1">Connecting to APCare Pharmacy...</p>
          </div>
        </div>
      }
    >
      <PricingReviewClient initialKey={initialKey} />
    </Suspense>
  );
}
