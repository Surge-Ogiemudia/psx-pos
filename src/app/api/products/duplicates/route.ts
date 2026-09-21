import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { AiDraftProduct } from "@/models/AiDraftProduct";
import DuplicateReviewDecision from "@/models/DuplicateReviewDecision";
import { requireApiSession, getBranchScope } from "@/lib/session";
import { handleApiError } from "@/lib/apiError";
import { cleanStr, diceSimilarity } from "@/lib/fuzzyMatch";
import { DUPLICATE_FUZZY_THRESHOLD, extractNumbers, sameNumbers } from "@/lib/duplicateDetection";

// Feeds Panel 4's "Possible Duplicates" tab in Monak Triage: live Products (already in the
// catalog) that look like the same physical item photographed on more than one shelf during
// the stock-take. Detected fresh on every request — nothing here is hardcoded or cached.

// extractNumbers/sameNumbers now live in duplicateDetection.ts so the exact same
// strength/pack-size guard is shared with Monak Triage's Panel 1->2 sibling-draft check —
// see that file for why (e.g. "Cloflam 100" vs "Cloflam 50" must never match).
const FUZZY_THRESHOLD = DUPLICATE_FUZZY_THRESHOLD;
// Duplicates are near-identical normalized strings, so once every product is sorted by its
// normalized name, true duplicates always land within a few slots of each other. Comparing
// each item only to its next COMPARE_WINDOW neighbors (instead of every other product) keeps
// this roughly O(n) instead of O(n^2) on a multi-thousand-product branch catalog.
const COMPARE_WINDOW = 40;

// Simple union-find (disjoint set) so an N-way cluster (e.g. the same item photographed on
// 3 shelves) collapses into one group instead of only ever pairing items two at a time.
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const scope = getBranchScope(session, request.nextUrl.searchParams.get("branchId"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const products = await Product.find(scope)
      .select("itemName brand size quantityInStock imageUrl createdAt")
      .lean<any[]>();

    if (products.length < 2) {
      return NextResponse.json({ groups: [] });
    }

    // Pairs an operator already confirmed are NOT duplicates — excluded from re-forming a
    // group no matter how the scan would otherwise score them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dismissed = await DuplicateReviewDecision.find({
      pharmacyId: scope.pharmacyId,
      branchId: scope.branchId,
      decision: "not_duplicate",
    })
      .select("productIdA productIdB")
      .lean<any[]>();
    const dismissedPairs = new Set(dismissed.map((d) => `${d.productIdA}_${d.productIdB}`));
    function isDismissed(idA: string, idB: string): boolean {
      const [a, b] = [idA, idB].sort();
      return dismissedPairs.has(`${a}_${b}`);
    }

    const items = products.map((p) => ({
      id: String(p._id),
      itemName: p.itemName as string,
      brand: p.brand as string,
      size: p.size as string,
      quantityInStock: p.quantityInStock as number,
      imageUrl: (p.imageUrl as string | null) ?? null,
      createdAt: p.createdAt,
      norm: cleanStr(`${p.itemName} ${p.size}`),
      numbers: extractNumbers(`${p.itemName} ${p.size}`),
    }));

    items.sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));

    const uf = new UnionFind(items.length);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && j <= i + COMPARE_WINDOW; j++) {
        const a = items[i];
        const b = items[j];
        if (isDismissed(a.id, b.id)) continue;

        const exact = a.norm.length > 0 && a.norm === b.norm;
        if (exact) {
          uf.union(i, j);
          continue;
        }

        const score = diceSimilarity(a.norm, b.norm);
        if (score < FUZZY_THRESHOLD) continue;

        // A high string-similarity score alone isn't enough — "Cloflam 100" vs "Cloflam 50"
        // or "LONART TABLET X18" vs "...X12" read as near-identical strings but are
        // different strengths/pack sizes, not duplicates. Only trust a FUZZY (non-exact)
        // match when neither side has a number, or both sides agree on every number found.
        if (a.numbers.length > 0 && b.numbers.length > 0 && !sameNumbers(a.numbers, b.numbers)) {
          continue;
        }

        uf.union(i, j);
      }
    }

    const groupsByRoot = new Map<number, number[]>();
    for (let i = 0; i < items.length; i++) {
      const root = uf.find(i);
      if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
      groupsByRoot.get(root)!.push(i);
    }

    const groupIndices = Array.from(groupsByRoot.values()).filter((g) => g.length >= 2);
    if (groupIndices.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    // Product only stores a single imageUrl — front AND back photos only exist on the
    // AiDraftProduct(s) that originated each Product. Some live products predate this
    // pipeline and have none, which is fine: those just fall back to imageUrl client-side.
    const allProductIds = groupIndices.flat().map((i) => items[i].id);
    const drafts = await AiDraftProduct.find({ productId: { $in: allProductIds } })
      .select("productId frontImageUrl backImageUrl createdAt")
      .sort({ createdAt: -1 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .lean<any[]>();
    const imagesByProduct = new Map<string, { frontImageUrl: string | null; backImageUrl: string | null }>();
    for (const d of drafts) {
      const pid = String(d.productId);
      if (!imagesByProduct.has(pid)) {
        imagesByProduct.set(pid, {
          frontImageUrl: d.frontImageUrl ?? null,
          backImageUrl: d.backImageUrl ?? null,
        });
      }
    }

    const groups = groupIndices
      .map((indices) => {
        const groupProducts = indices.map((i) => {
          const it = items[i];
          const imgs = imagesByProduct.get(it.id);
          return {
            _id: it.id,
            itemName: it.itemName,
            brand: it.brand,
            size: it.size,
            quantityInStock: it.quantityInStock,
            imageUrl: it.imageUrl,
            frontImageUrl: imgs?.frontImageUrl ?? null,
            backImageUrl: imgs?.backImageUrl ?? null,
            createdAt: it.createdAt,
          };
        });
        const norms = indices.map((i) => items[i].norm);
        const matchType: "exact" | "fuzzy" = norms.every((n) => n === norms[0]) ? "exact" : "fuzzy";
        return {
          groupKey: groupProducts
            .map((p) => p._id)
            .sort()
            .join("-"),
          matchType,
          products: groupProducts,
        };
      })
      // Exact-name groups first, then biggest clusters — puts the most obvious,
      // highest-confidence duplicates at the top of the review queue.
      .sort((a, b) => {
        if (a.matchType !== b.matchType) return a.matchType === "exact" ? -1 : 1;
        return b.products.length - a.products.length;
      });

    return NextResponse.json({ groups });
  } catch (error) {
    return handleApiError(error);
  }
}
