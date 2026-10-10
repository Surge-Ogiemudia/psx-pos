// A branch sees its own customers plus the ones not yet pinned to any branch (customers from
// before branches existed, and bulk-store customers).
export function inBranch(branchId: string) {
  return { $or: [{ branchId }, { branchId: null }] };
}
