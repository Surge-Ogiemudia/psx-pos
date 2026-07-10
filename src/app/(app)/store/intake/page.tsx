import { requireStorePageSession } from "@/lib/session";
import { resolveActiveStore } from "@/lib/storeScope";
import IntakeClient from "./IntakeClient";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const { activeStoreId } = await resolveActiveStore(session);
  const resolvedStoreId = storeId || activeStoreId || "";
  return <IntakeClient key={resolvedStoreId} initialStoreId={resolvedStoreId} />;
}
