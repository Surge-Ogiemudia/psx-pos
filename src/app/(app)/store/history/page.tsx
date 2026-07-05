import { requireStorePageSession } from "@/lib/session";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireStorePageSession();
  const { storeId } = await searchParams;
  return <HistoryClient initialStoreId={storeId ?? ""} />;
}
