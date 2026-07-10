import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import StoreDashboardClient from "./StoreDashboardClient";

export default async function StorePage() {
  const session = await requireStorePageSession();
  const { activeStoreId, canSwitch } = await resolveActiveStore(session);
  const canDelete = session.user.role === "admin" || session.user.role === "store_manager";
  // A store_keeper only ever browses their own store — the picker/switcher (nav bar) is only
  // meaningful for admin/store_manager, who genuinely have more than one store to choose from.
  return (
    <StoreDashboardClient
      key={activeStoreId ?? "none"}
      fixedStoreId={canSwitch ? null : activeStoreId}
      activeStoreId={activeStoreId}
      canDelete={canDelete}
    />
  );
}
