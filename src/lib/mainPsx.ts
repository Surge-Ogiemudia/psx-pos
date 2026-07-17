/** Base URL of the separate Main PSX platform that owns staff identity/auth for this app. */
export function getMainPsxUrl(): string {
  return process.env.NODE_ENV === "production" ? "https://www.psx.ng" : "http://localhost:3000";
}
