/**
 * Parses a number from user input or a request body, tolerating thousands separators
 * (e.g. "1,000" or "1,234.50"). Used at every boundary where a human might type a comma —
 * both client-side and on the API routes that receive raw request bodies, since a comma
 * should never be silently rejected or turned into NaN anywhere in the app.
 */
export function parseNumeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return NaN;
  return Number(cleaned);
}
