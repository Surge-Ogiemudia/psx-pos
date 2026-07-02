import { requirePageSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import NavBar from "./NavBar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();

  await dbConnect();
  const pharmacy = await Pharmacy.findById(session.user.pharmacyId).lean();

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
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
