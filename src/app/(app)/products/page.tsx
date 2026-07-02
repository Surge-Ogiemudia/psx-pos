import { requirePageSession } from "@/lib/session";
import ProductsClient from "./ProductsClient";

export default async function ProductsPage() {
  const session = await requirePageSession();
  return <ProductsClient isAdmin={session.user.role === "admin"} />;
}
