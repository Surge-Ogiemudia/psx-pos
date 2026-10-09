// Receipts list their items A to Z. Done when the receipt is printed, on a copy, so the saved
// sale (and the cart, stock records and reports) keep their original order.
//
// Case-insensitive, and numbers compare as numbers ("5% Dextrose" before "10% Dextrose"). A
// line's name is "item · size · brand", so items sort by name, then size, then brand. Lines
// that compare equal stay in the order they were rung up.
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function sortItemsAlphabetically<T extends { productName: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => collator.compare(a.item.productName, b.item.productName) || a.index - b.index)
    .map(({ item }) => item);
}
