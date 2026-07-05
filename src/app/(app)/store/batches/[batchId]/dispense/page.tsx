import { requireStorePageSession } from "@/lib/session";
import DispenseSettingClient from "./DispenseSettingClient";

export default async function DispenseSettingPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireStorePageSession();
  const { batchId } = await params;
  return <DispenseSettingClient batchId={batchId} />;
}
