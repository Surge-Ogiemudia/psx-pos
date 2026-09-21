// Shared queue-partitioning logic for Monak Triage, used by both the desktop
// (MonakTriageClient.tsx) and mobile (monak-triage/mobile/MonakTriageMobileClient.tsx)
// tools so "View 1/2/3" means the identical set of items on either platform.

export const LANE_COUNT = 3;
export const VIEW_STORAGE_KEY = "psx_monak_triage_view";

// Stable 3-way split so operators can each work a fixed lane without colliding.
// Based on the item's own id (not its position in the list), so an item never jumps
// lanes as new snaps arrive and the newest-first order shifts underneath it.
export function laneOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % LANE_COUNT;
}
