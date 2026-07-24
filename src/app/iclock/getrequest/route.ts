import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // ZKTeco devices poll this endpoint periodically to get commands from the server.
  // Returning OK tells the device there are no pending commands.
  return new NextResponse("OK", { status: 200 });
}
