import { requireStorePageSession } from "@/lib/session";
import BuyersClient from "./BuyersClient";

export default async function BuyersPage() {
  await requireStorePageSession();
  return <BuyersClient />;
}
