import { NextRequest, NextResponse } from "next/server";
import { PLATFORM_ONBOARD_COOKIE } from "@/lib/platformOnboardAuth";

const MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

export async function POST(request: NextRequest) {
  const secret = process.env.PLATFORM_ONBOARD_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Platform onboarding is not configured" }, { status: 503 });
  }

  const body = await request.json();
  const password = typeof body.password === "string" ? body.password : "";
  if (password !== secret) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PLATFORM_ONBOARD_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
