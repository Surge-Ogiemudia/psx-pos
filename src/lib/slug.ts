export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Default slug source: just the pharmacy name's first word ("Monak" out of "Monak Pharmacy"),
// not the whole name — simpler and more predictable than trying to strip known suffix words
// ("Pharmacy", "Chemist", "Meds", ...), which would always be an incomplete list.
export function firstWordSlug(pharmacyName: string): string {
  const firstWord = pharmacyName.trim().split(/\s+/)[0] || "";
  return slugify(firstWord);
}
