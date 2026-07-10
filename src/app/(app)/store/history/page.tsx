import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const { activeStoreId } = await resolveActiveStore(session);
  const resolvedStoreId = storeId || activeStoreId || "";
  return <HistoryClient key={resolvedStoreId} initialStoreId={resolvedStoreId} />;
}
