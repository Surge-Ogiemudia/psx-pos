import { requireRetailPageSession } from "@/lib/session";
import DispensaryClient from "./DispensaryClient";

export default async function DispensaryPage() {
  const session = await requireRetailPageSession();
  return <DispensaryClient pharmacyId={session.user.pharmacyId} />;
}
