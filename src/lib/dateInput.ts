const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function isValidDate(year: number, monthIndex: number, day: number): boolean {
  if (monthIndex < 0 || monthIndex > 11 || day < 1) return false;
  const d = new Date(year, monthIndex, day);
  return d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day;
}

/**
 * Parses an expiry date typed in whatever format a pharmacist pastes in from a spreadsheet —
 * ISO ("2026-11-01"), day-first numeric ("01/11/26", "1-11-2026"), or month+year only
 * ("Nov 2026", "November 2026"). Day-first is the assumed convention for ambiguous numeric
 * dates (matches local usage); if that produces an invalid date, month-first is tried as a
 * fallback rather than rejecting the input outright. A bare month+year defaults to the LAST day
 * of that month — matching how expiry is printed on packaging ("EXP: NOV 2026" means good
 * through the end of November), not the 1st. Returns null if nothing sensible can be parsed.
 */
export function parseExpiryDateLoose(raw: string): Date | null {
  const input = raw.trim();
  if (!input) return null;

  // ISO: 2026-11-01 (also accepts 2026/11/01)
  const iso = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const monthIndex = Number(m) - 1;
    const day = Number(d);
    if (isValidDate(year, monthIndex, day)) return new Date(year, monthIndex, day);
    return null;
  }

  // Month + year only, e.g. "Nov 2026", "November 2026" — defaults to the last day of that month.
  const monthYear = input.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (monthYear) {
    const monthIndex = MONTH_NAMES[monthYear[1].toLowerCase()];
    const year = Number(monthYear[2]);
    if (monthIndex !== undefined) {
      return new Date(year, monthIndex + 1, 0); // day 0 of next month = last day of this month
    }
  }

  // Numeric day/month/year with /, -, or . separators, 2-4 digit year: "01/11/26", "1-11-2026"
  const numeric = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = fullYear(Number(numeric[3]));
    // Prefer day-first (a=day, b=month); fall back to month-first if that's invalid.
    if (isValidDate(year, b - 1, a)) return new Date(year, b - 1, a);
    if (isValidDate(year, a - 1, b)) return new Date(year, a - 1, b);
    return null;
  }

  // Last resort: let the browser/engine try (handles things like "November 1, 2026").
  const fallback = new Date(input);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
