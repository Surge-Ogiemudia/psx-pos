import { requirePageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";
import Store from "@/models/Store";
import NavBar from "./NavBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();

  await dbConnect();
  const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();
  const { activeBranchId, branches } = await resolveActiveBranch(session);

  // Staff/store_keeper are fixed to one branch or store — surface its name in the nav
  // so it's obvious at a glance which location they're acting on behalf of.
  let scopeLabel: string | null = null;
  if (session.user.role === "staff" && session.user.branchId) {
    const branch = await Branch.findById(session.user.branchId).lean();
    scopeLabel = branch?.branchName ?? null;
  } else if ((session.user.role === "store_keeper" || session.user.role === "store_manager") && session.user.storeId) {
    const store = await Store.findById(session.user.storeId).lean();
    scopeLabel = store?.storeName ?? null;
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
        scopeLabel={scopeLabel}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
