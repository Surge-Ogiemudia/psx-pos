/**
 * Shared fuzzy string-matching helpers for Monak data-matching flows.
 *
 * Same normalization + Dice's-coefficient algorithm already proven on this
 * pharmacy's product-name data in `seed_monak_reconciliation.js` (repo root),
 * ported to TypeScript so it can be reused across API routes.
 */

export function cleanStr(s: string): string {
  return (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function diceSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;

  const bigrams1 = new Set<string>();
  for (let i = 0; i < str1.length - 1; i++) {
    bigrams1.add(str1.substring(i, i + 2));
  }

  let intersection = 0;
  for (let i = 0; i < str2.length - 1; i++) {
    const bigram = str2.substring(i, i + 2);
    if (bigrams1.has(bigram)) intersection++;
  }

  return (2.0 * intersection) / (str1.length + str2.length - 2);
}

export interface FuzzyRankOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Ranks `candidates` by fuzzy similarity of `getText(candidate)` to `query`,
 * using the same clean + Dice-coefficient approach as `seed_monak_reconciliation.js`.
 * Filters out anything below `minScore`, sorts descending by score, and
 * returns the top `limit` items.
 */
export function fuzzyRank<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string,
  opts?: FuzzyRankOptions
): T[] {
  const limit = opts?.limit ?? 15;
  const minScore = opts?.minScore ?? 0.2;

  const cleanQuery = cleanStr(query);

  const scored = candidates.map((item) => {
    const cleanCandidate = cleanStr(getText(item));
    let score = diceSimilarity(cleanQuery, cleanCandidate);

    // Boost if exact normalized match
    if (cleanQuery === cleanCandidate) score = 1.0;

    return { item, score };
  });

  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}
