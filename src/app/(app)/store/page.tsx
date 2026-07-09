import { requireStorePageSession } from "@/lib/session";
import StoreDashboardClient from "./StoreDashboardClient";

export default async function StorePage() {
  const session = await requireStorePageSession();
  // A store_keeper only ever browses their own store — the picker is only meaningful
  // for admin/store_manager, who genuinely have more than one store to choose from.
  const fixedStoreId = session.user.role === "store_keeper" ? session.user.storeId : null;
  return <StoreDashboardClient fixedStoreId={fixedStoreId} />;
}
