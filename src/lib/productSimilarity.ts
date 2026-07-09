export interface ProductIdentity {
  itemName: string;
  brand: string;
  size: string;
}

export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 1 = identical, 0 = completely different. */
function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function isExactIdentity(a: ProductIdentity, b: ProductIdentity): boolean {
  return (
    normalizeText(a.itemName) === normalizeText(b.itemName) &&
    normalizeText(a.brand) === normalizeText(b.brand) &&
    normalizeText(a.size) === normalizeText(b.size)
  );
}

export interface SimilarMatch<T extends ProductIdentity> {
  product: T;
  score: number;
  exact: boolean;
}

/**
 * Flags catalog entries that are probably the same real-world item as `candidate` — either an
 * exact itemName+brand+size match, or a likely fat-finger typo (close edit distance / substring
 * on itemName, with a matching-or-blank brand). Size differences alone never disqualify a match:
 * a typo can happen alongside a genuinely different size, and it's still worth asking about.
 */
export function findSimilarProducts<T extends ProductIdentity>(
  candidate: ProductIdentity,
  existing: T[]
): SimilarMatch<T>[] {
  const nItem = normalizeText(candidate.itemName);
  const nBrand = normalizeText(candidate.brand);
  const nSize = normalizeText(candidate.size);

  const results: SimilarMatch<T>[] = [];
  for (const p of existing) {
    const pItem = normalizeText(p.itemName);
    const pBrand = normalizeText(p.brand);
    const pSize = normalizeText(p.size);

    const exact = nItem === pItem && nBrand === pBrand && nSize === pSize;
    const itemRatio = similarityRatio(nItem, pItem);
    const itemClose =
      itemRatio >= 0.7 ||
      (nItem.length > 2 && pItem.length > 2 && (pItem.includes(nItem) || nItem.includes(pItem)));
    const brandRatio = similarityRatio(nBrand, pBrand);
    const brandClose =
      !nBrand || !pBrand || brandRatio >= 0.55 || pBrand.includes(nBrand) || nBrand.includes(pBrand);

    if (exact || (itemClose && brandClose)) {
      results.push({ product: p, score: exact ? 1 : itemRatio, exact });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Ranks how well a free-typed search query matches a product, for search-as-you-type. Prefix
 * matches (the common case — someone typing the start of a name) score highest, then substring
 * matches, then typo-tolerant fuzzy matches (e.g. "Swoss"/"Suoss"/"S'wiss" all still finding
 * "Swiss") scored lower so exact/prefix hits always sort above a merely-similar spelling.
 * Returns 0 when nothing matches at all.
 */
export function productSearchScore(query: string, product: ProductIdentity): number {
  const q = normalizeText(query);
  if (!q) return 1;

  const fields = [product.itemName, product.brand, product.size].map(normalizeText);
  let best = 0;

  for (const field of fields) {
    if (!field) continue;
    if (field === q) return 1;

    const tokens = field.split(" ");
    for (const token of tokens) {
      if (!token) continue;
      if (token === q) best = Math.max(best, 0.97);
      else if (token.startsWith(q)) best = Math.max(best, 0.9);
      else if (token.includes(q)) best = Math.max(best, 0.75);
      else if (q.length >= 3 && Math.abs(token.length - q.length) <= 3) {
        const ratio = similarityRatio(q, token);
        if (ratio >= 0.6) best = Math.max(best, ratio * 0.65);
      }
    }

    if (field.includes(q)) best = Math.max(best, 0.8);
  }

  return best;
}
