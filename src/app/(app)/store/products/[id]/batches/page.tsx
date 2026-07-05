import { requireStorePageSession } from "@/lib/session";
import BatchListClient from "./BatchListClient";

export default async function BatchListPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStorePageSession();
  const { id } = await params;
  return <BatchListClient storeProductId={id} />;
}
