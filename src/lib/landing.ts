// Where each role starts after sign-in (and after any "go home" redirect).
//  - store manager: the Bulk Store
//  - store keeper attached to a branch: Point of Sale (they can reach the Bulk Store from the nav)
//  - store keeper with no branch: the Bulk Store — there is no POS for them to land on
//  - admin / staff: Point of Sale
export function landingPathFor(user: { role: string; branchId?: string | null }): "/pos" | "/store" {
  if (user.role === "store_manager") return "/store";
  if (user.role === "store_keeper") return user.branchId ? "/pos" : "/store";
  return "/pos";
}
