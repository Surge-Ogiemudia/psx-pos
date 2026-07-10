import { requireStorePageSession } from "@/lib/session";
import BulkIntakeClient from "./BulkIntakeClient";

export default async function BulkIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireStorePageSession();
  const { storeId } = await searchParams;
  return <BulkIntakeClient initialStoreId={storeId ?? ""} />;
}
