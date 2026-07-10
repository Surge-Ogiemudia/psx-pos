import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import PushSellClient from "./PushSellClient";

export default async function PushSellPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const { activeStoreId } = await resolveActiveStore(session);
  const resolvedStoreId = storeId || activeStoreId || "";
  const canWriteOff = session.user.role === "admin" || session.user.role === "store_manager";
  return <PushSellClient key={resolvedStoreId} initialStoreId={resolvedStoreId} canWriteOff={canWriteOff} />;
}
