import { cookies } from "next/headers";
import { isPlatformOnboardAuthed, PLATFORM_ONBOARD_COOKIE } from "@/lib/platformOnboardAuth";
import PasswordGateClient from "./PasswordGateClient";
import OnboardFormClient from "./OnboardFormClient";

export default async function OnboardPage() {
  const cookieValue = (await cookies()).get(PLATFORM_ONBOARD_COOKIE)?.value;
  const authed = isPlatformOnboardAuthed(cookieValue);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      {authed ? <OnboardFormClient /> : <PasswordGateClient />}
    </div>
  );
}
