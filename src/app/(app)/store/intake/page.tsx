import { requireStorePageSession } from "@/lib/session";
import IntakeClient from "./IntakeClient";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireStorePageSession();
  const { storeId } = await searchParams;
  return <IntakeClient initialStoreId={storeId ?? ""} />;
}
