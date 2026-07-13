export const PLATFORM_ONBOARD_COOKIE = "platform_onboard_auth";

export function isPlatformOnboardAuthed(cookieValue: string | undefined): boolean {
  const secret = process.env.PLATFORM_ONBOARD_SECRET;
  return Boolean(secret) && cookieValue === secret;
}
