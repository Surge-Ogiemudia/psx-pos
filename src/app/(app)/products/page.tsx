import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ProductsClient from "./ProductsClient";

export default async function ProductsPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  return <ProductsClient isAdmin={session.user.role === "admin"} branchId={activeBranchId} />;
}
