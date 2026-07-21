import { requireRetailPageSession } from "@/lib/session";
import { resolveActiveBranch } from "@/lib/branchScope";
import ProductsClient from "./ProductsClient";

export default async function ProductsPage() {
  const session = await requireRetailPageSession();
  const { activeBranchId } = await resolveActiveBranch(session);
  
  const canEditStock = ["admin", "staff", "store_manager", "store_keeper"].includes(session.user.role);

  return (
    <ProductsClient 
      isAdmin={session.user.role === "admin"} 
      canEditStock={canEditStock}
      branchId={activeBranchId} 
    />
  );
}
