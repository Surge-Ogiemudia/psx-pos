import { requireAdminPageSession } from "@/lib/session";
import StaffClient from "./StaffClient";

export default async function StaffPage() {
  await requireAdminPageSession();
  return <StaffClient />;
}
