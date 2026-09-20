// A raw expiry date input can be garbage in ways that don't throw: a numeric string like
// "46692" (an unconverted Excel serial date) parses via `new Date()` into an absurd year
// instead of erroring. Treat anything outside a sane pharmacy-stock range as invalid rather
// than silently saving it.
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

export function parseExpiryDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return parsed;
}
