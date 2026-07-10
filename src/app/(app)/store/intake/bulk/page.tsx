import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import BulkIntakeClient from "./BulkIntakeClient";

export default async function BulkIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const { activeStoreId } = await resolveActiveStore(session);
  const resolvedStoreId = storeId || activeStoreId || "";
  return <BulkIntakeClient key={resolvedStoreId} initialStoreId={resolvedStoreId} />;
}
