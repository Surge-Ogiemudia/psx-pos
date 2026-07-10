import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import BulkPushClient from "./BulkPushClient";

export default async function BulkPushPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const { activeStoreId } = await resolveActiveStore(session);
  const resolvedStoreId = storeId || activeStoreId || "";
  return <BulkPushClient key={resolvedStoreId} initialStoreId={resolvedStoreId} />;
}
