import { requireStorePageSession } from "@/lib/session";
import PushSellClient from "./PushSellClient";

export default async function PushSellPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  const session = await requireStorePageSession();
  const { storeId } = await searchParams;
  const canWriteOff = session.user.role === "admin" || session.user.role === "store_manager";
  return <PushSellClient initialStoreId={storeId ?? ""} canWriteOff={canWriteOff} />;
}
