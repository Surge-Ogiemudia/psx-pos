import { requireAdminPageSession } from "@/lib/session";
import StoresClient from "./StoresClient";

export default async function StoresPage() {
  await requireAdminPageSession();
  return <StoresClient />;
}
