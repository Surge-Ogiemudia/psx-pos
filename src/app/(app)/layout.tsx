import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Store from "@/models/Store";
import NavBar from "./NavBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();

  await dbConnect();
  const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();
  const { activeBranchId, activeBranchName, branches } = await resolveActiveBranch(session);

  // Store keeper is locked to one store the same way staff is locked to one branch — show it
  // the same way, so it's always clear which place a login is scoped to.
  let activeStoreName: string | null = null;
  if (session.user.role === "store_keeper" && session.user.storeId) {
    const store = await Store.findById(session.user.storeId).lean();
    activeStoreName = store?.storeName ?? null;
  }

  const brandColor = pharmacy?.brandColor || "#0f766e";
  const pharmacyName = pharmacy?.pharmacyName || "Pharmacy";
  const logoUrl = pharmacy?.logoUrl || "";

  return (
    <div className="flex min-h-screen flex-col" style={{ ["--brand-color" as string]: brandColor }}>
      <NavBar
        pharmacyName={pharmacyName}
        logoUrl={logoUrl}
        userName={session.user.name ?? ""}
        userRole={session.user.role}
        branches={branches}
        activeBranchId={activeBranchId}
        activeBranchName={activeBranchName}
        activeStoreName={activeStoreName}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
