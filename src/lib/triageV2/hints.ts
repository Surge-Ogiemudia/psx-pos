// Triage v2 price hints: pure scoring + inverted-index lookup (no DB).
// NOTE: scripts/triage-v2-build-hints.mjs duplicates this logic (plain ESM cannot import TS).
// Keep both in sync when changing scoring rules or constants.

export interface ExcelPriceRow {
  itemName: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

export interface PriceHint {
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  score: number;
}

export const MIN_HINT_SCORE = 0.7;
export const MAX_HINTS = 3;
export const NUMBER_MATCH_BONUS = 0.05;
export const NUMBER_MISMATCH_PENALTY = 0.15;

/** Product display name for matching: itemName plus size unless size is 'Standard'. */
export function productMatchName(itemName: string, size?: string | null): string {
  const s = (size ?? "").trim();
  return s && s.toLowerCase() !== "standard" ? `${itemName} ${s}` : itemName;
}

export function normalizeAlnum(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Bigram multiset of the alphanumerics-only lowercased string. */
export function bigramMap(s: string): { map: Map<string, number>; total: number } {
  const n = normalizeAlnum(s);
  const map = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < n.length - 1; i++) {
    const g = n.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
    total++;
  }
  return { map, total };
}

/** Numeric tokens (decimals kept), sorted, e.g. "Vit C 0.5g x 30" -> ["0.5","30"]. */
export function numericTokens(s: string): string[] {
  return (String(s ?? "").toLowerCase().match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

export function diceFromOverlap(overlap: number, totalA: number, totalB: number): number {
  return totalA + totalB === 0 ? 0 : (2 * overlap) / (totalA + totalB);
}

/** Adjust a raw dice score by numeric-token agreement. Clamped to [0,1]. */
export function adjustScore(dice: number, numsA: string[], numsB: string[]): number {
  let score = dice;
  if (numsA.length && numsB.length) {
    const same = numsA.length === numsB.length && numsA.every((t, i) => t === numsB[i]);
    score += same ? NUMBER_MATCH_BONUS : -NUMBER_MISMATCH_PENALTY;
  }
  return Math.max(0, Math.min(1, score));
}

/** Full pairwise score (dice + numeric adjustment). */
export function scoreNames(a: string, b: string): number {
  const A = bigramMap(a);
  const B = bigramMap(b);
  let overlap = 0;
  for (const [g, c] of A.map) overlap += Math.min(c, B.map.get(g) ?? 0);
  return adjustScore(diceFromOverlap(overlap, A.total, B.total), numericTokens(a), numericTokens(b));
}

export function isUsableRow(r: ExcelPriceRow): boolean {
  return r.retailPrice > 0 && !(r.wholesalePrice > r.retailPrice);
}

export interface HintIndex {
  rows: ExcelPriceRow[];
  totals: number[];
  nums: string[][];
  postings: Map<string, Array<[number, number]>>; // bigram -> [rowIdx, count]
}

/** Precompute bigram maps + inverted index once; drops bad rows and exact duplicates. */
export function buildHintIndex(input: ExcelPriceRow[]): HintIndex {
  const seen = new Set<string>();
  const rows: ExcelPriceRow[] = [];
  const totals: number[] = [];
  const nums: string[][] = [];
  const postings = new Map<string, Array<[number, number]>>();
  for (const r of input) {
    if (!isUsableRow(r)) continue;
    const key = `${normalizeAlnum(r.itemName)}|${r.retailPrice}|${r.wholesalePrice}|${r.distributorPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = rows.length;
    const { map, total } = bigramMap(r.itemName);
    rows.push(r);
    totals.push(total);
    nums.push(numericTokens(r.itemName));
    for (const [g, c] of map) {
      let p = postings.get(g);
      if (!p) postings.set(g, (p = []));
      p.push([idx, c]);
    }
  }
  return { rows, totals, nums, postings };
}

/** Top hints (<= MAX_HINTS, score >= MIN_HINT_SCORE) for one product name. */
export function findHints(index: HintIndex, productName: string): PriceHint[] {
  const q = bigramMap(productName);
  if (!q.total) return [];
  const qNums = numericTokens(productName);
  const overlap = new Map<number, number>();
  for (const [g, qc] of q.map) {
    const p = index.postings.get(g);
    if (!p) continue;
    for (const [idx, c] of p) overlap.set(idx, (overlap.get(idx) ?? 0) + Math.min(qc, c));
  }
  const scored: PriceHint[] = [];
  for (const [idx, ov] of overlap) {
    const score = adjustScore(diceFromOverlap(ov, q.total, index.totals[idx]), qNums, index.nums[idx]);
    if (score < MIN_HINT_SCORE) continue;
    const r = index.rows[idx];
    scored.push({
      name: r.itemName,
      retailPrice: r.retailPrice,
      wholesalePrice: r.wholesalePrice,
      distributorPrice: r.distributorPrice,
      score: Math.round(score * 1000) / 1000,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, MAX_HINTS);
}
