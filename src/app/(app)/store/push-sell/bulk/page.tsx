import { requireStorePageSession } from "@/lib/session";
import BulkPushClient from "./BulkPushClient";

export default async function BulkPushPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireStorePageSession();
  const { storeId } = await searchParams;
  return <BulkPushClient initialStoreId={storeId ?? ""} />;
}
