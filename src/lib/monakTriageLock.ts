import { NextResponse } from "next/server";

// Master switch for Monak Triage. While true, Monak's Triage pages show a "locked" screen and every
// Triage API route answers 503, so nobody can confirm/skip/merge drafts while a data cleanup runs.
// Only affects Monak's pharmacy. Set to false and deploy to unlock.
export const MONAK_TRIAGE_LOCKED = true;
const MONAK_PHARMACY_ID = "6a5f61da9e1719c3b02842ae";

export function isMonakTriageLocked(pharmacyId: string | null | undefined): boolean {
  return MONAK_TRIAGE_LOCKED && String(pharmacyId ?? "") === MONAK_PHARMACY_ID;
}

// 503 (not 4xx) so the phones' offline queue treats it as "try again later" and keeps the saved
// work instead of marking it failed.
export function triageLockedResponse() {
  return NextResponse.json(
    { error: "Monak Triage is temporarily locked while the catalog is being cleaned up. Please try again shortly.", locked: true },
    { status: 503 }
  );
}
