import { requireAdminPageSession } from "@/lib/session";
import BatchListClient from "./BatchListClient";

export default async function ProductBatchListPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPageSession();
  const { id } = await params;
  return <BatchListClient productId={id} />;
}
