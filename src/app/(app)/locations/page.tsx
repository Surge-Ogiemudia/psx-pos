import { requireAdminPageSession } from "@/lib/session";
import LocationsClient from "./LocationsClient";

export default async function LocationsPage() {
  await requireAdminPageSession();
  return <LocationsClient />;
}
