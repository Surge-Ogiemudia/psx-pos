import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/session";

export default async function AppHome() {
  const session = await requirePageSession();
  if (session.user.role === "store_manager" || session.user.role === "store_keeper") {
    redirect("/store");
  }
  redirect("/pos");
}
