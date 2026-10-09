import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/session";
import { landingPathFor } from "@/lib/landing";

// The front door: sign-in, the installed app's start page and every "go home" redirect land
// here, and each person is sent to where they work.
export default async function AppHome() {
  const session = await requirePageSession();
  redirect(landingPathFor(session.user));
}
