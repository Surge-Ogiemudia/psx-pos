import { requirePageSession } from "@/lib/session";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  await requirePageSession();
  return <ReportsClient />;
}
