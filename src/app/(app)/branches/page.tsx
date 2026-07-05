import { requireAdminPageSession } from "@/lib/session";
import BranchesClient from "./BranchesClient";

export default async function BranchesPage() {
  await requireAdminPageSession();
  return <BranchesClient />;
}
