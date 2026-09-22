/**
 * Client-side equivalents of two Monak Triage Mobile server endpoints, so the mobile client
 * can browse/review/edit the queue with zero network calls once the initial sync has happened
 * (stage 1 of the offline plan — writes/Confirm/Skip/Merge are explicitly out of scope and
 * still require a live connection).
 *
 * Both functions reuse the exact same shared matching primitives the server routes use
 * (`isDuplicateText`, `fuzzyRank`) rather than reimplementing any scoring logic, so online and
 * offline results can never silently diverge. The filtering/shaping around those primitives
 * mirrors each server route line-for-line so the *set* of candidates fed into them is the same
 * too, not just the scoring function.
 */
import { isDuplicateText } from "./duplicateDetection";
import { fuzzyRank } from "./fuzzyMatch";
import type { LocalCatalogProduct, LocalPriceListItem } from "./monakTriageDb";

export interface DuplicateCandidate {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  imageUrl: string | null;
  quantityInStock: number;
}

export interface PriceMatch {
  _id: string;
  itemName: string;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
}

/**
 * Mirrors GET /api/products/[id]/possible-duplicates: given the live product currently being
 * triaged (looked up from the cached catalog by id, same as the server's `Product.findOne`),
 * find OTHER cached branch products whose name reads as the same physical item.
 *
 * `currentProductId` not being present in the cached catalog (e.g. it hasn't synced down yet)
 * is treated the same as "nothing to compare" — an empty result, not an error — exactly like
 * the equivalent case wasn't distinguished server-side either.
 */
export function findLocalDuplicateCandidates(
  currentProductId: string,
  catalog: LocalCatalogProduct[]
): DuplicateCandidate[] {
  const current = catalog.find((p) => p._id === currentProductId);
  if (!current) return [];

  return catalog
    .filter((p) => p._id !== currentProductId && isDuplicateText(current.itemName, p.itemName))
    .map((p) => ({
      _id: p._id,
      itemName: p.itemName,
      brand: p.brand,
      size: p.size,
      imageUrl: p.imageUrl,
      quantityInStock: p.quantityInStock,
    }));
}

// Same word-splitting threshold used by /api/monak-excel2's `$or` word-regex prefilter, so the
// candidate set handed to fuzzyRank is the same shape (a broad "shares at least one meaningful
// word" pass) rather than a plain substring test that could rank differently.
function significantWords(s: string): string[] {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
}

/**
 * Mirrors GET /api/monak-excel2?search=…: word-prefilter the cached price list down to items
 * sharing at least one meaningful word with the query (same DB regex-`$or` semantics, done
 * in-memory instead), capped at the same 300-candidate ceiling the server's `.limit(300)`
 * applies, then fuzzy-ranks with the shared `fuzzyRank` helper using its same defaults
 * (limit 15, minScore 0.2).
 */
export function searchLocalPriceList(query: string, priceList: LocalPriceListItem[]): PriceMatch[] {
  const search = query.trim();
  if (!search) return [];

  const words = significantWords(search);
  const lowerWords = words.map((w) => w.toLowerCase());
  const lowerSearch = search.toLowerCase();

  const candidates =
    lowerWords.length > 0
      ? priceList.filter((item) => {
          const name = (item.itemName ?? "").toLowerCase();
          return lowerWords.some((w) => name.includes(w));
        })
      : priceList.filter((item) => (item.itemName ?? "").toLowerCase().includes(lowerSearch));

  const capped = candidates.slice(0, 300);

  return fuzzyRank(search, capped, (item) => item.itemName ?? "", { limit: 15 }).map((m) => ({
    _id: m._id,
    itemName: m.itemName,
    retailPrice: m.retailPrice,
    wholesalePrice: m.wholesalePrice,
    distributorPrice: m.distributorPrice,
  }));
}
