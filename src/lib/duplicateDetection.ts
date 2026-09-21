/**
 * Shared duplicate-detection guard, factored out of `products/duplicates/route.ts` so every
 * code path that decides "are these two items actually the same physical product" — the
 * Panel 4 live-catalog scan AND Monak Triage's Panel 1->2 sibling-draft check — shares
 * exactly the same rule. Critical: a high string-similarity score alone is never enough —
 * "Cloflam 100" vs "Cloflam 50", or "LONART TABLET X18" vs "...X12", read as near-identical
 * text but are different strengths/pack sizes, never duplicates of each other.
 */
import { cleanStr, diceSimilarity } from "./fuzzyMatch";

export const DUPLICATE_FUZZY_THRESHOLD = 0.75;

export function extractNumbers(s: string): string[] {
  return (s.match(/\d+/g) || []).slice().sort();
}

export function sameNumbers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => n === b[i]);
}

/**
 * True when two raw (un-normalized) name/size strings should be treated as the same item:
 * either an exact match once cleaned, or a high Dice-similarity fuzzy match where the
 * strength/pack-size guard passes (neither side has digits, or both sides agree on every
 * digit found).
 */
export function isDuplicateText(
  rawA: string,
  rawB: string,
  threshold: number = DUPLICATE_FUZZY_THRESHOLD
): boolean {
  const normA = cleanStr(rawA);
  const normB = cleanStr(rawB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const score = diceSimilarity(normA, normB);
  if (score < threshold) return false;

  const numbersA = extractNumbers(rawA);
  const numbersB = extractNumbers(rawB);
  if (numbersA.length > 0 && numbersB.length > 0 && !sameNumbers(numbersA, numbersB)) {
    return false;
  }

  return true;
}
