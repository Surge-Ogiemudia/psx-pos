import type { ProductCategory } from "@/lib/types";

// The POS "category view" switch. It only changes which products the search shows at that
// moment — it never touches stock, prices or the cart.
export type PosCategoryFilter = "all" | ProductCategory;

export const POS_CATEGORY_FILTER_KEY = "psxPosCategoryFilter";

export const POS_CATEGORY_OPTIONS: { value: PosCategoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "medicine", label: "Medicine" },
  { value: "supermarket", label: "Supermarket" },
  { value: "non-medicine", label: "Non-medicine" },
];

export function isPosCategoryFilter(v: unknown): v is PosCategoryFilter {
  return POS_CATEGORY_OPTIONS.some((o) => o.value === v);
}

export function filterByCategory<T extends { category?: ProductCategory | null }>(
  products: T[],
  filter: PosCategoryFilter
): T[] {
  return filter === "all" ? products : products.filter((p) => p.category === filter);
}
