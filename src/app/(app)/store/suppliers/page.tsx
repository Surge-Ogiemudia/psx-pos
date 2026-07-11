import { requireStorePageSession } from "@/lib/session";
import SuppliersClient from "./SuppliersClient";

export default async function SuppliersPage() {
  await requireStorePageSession();
  return <SuppliersClient />;
}
