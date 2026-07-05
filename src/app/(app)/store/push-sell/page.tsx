import { requireStorePageSession } from "@/lib/session";
import PushSellClient from "./PushSellClient";

export default async function PushSellPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireStorePageSession();
  const { storeId } = await searchParams;
  return <PushSellClient initialStoreId={storeId ?? ""} />;
}
