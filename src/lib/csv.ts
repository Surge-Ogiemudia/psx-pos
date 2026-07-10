/**
 * Naive CSV parser (no quoted-field support) — good enough for the simple, comma-only exports
 * this app produces and the spreadsheet-saved-as-CSV files staff upload. Rows map header name
 * to cell value case-insensitively so column order in the file never matters.
 */
export function parseCsv(text: string): { rows: Record<string, string>[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { rows: [], error: "Paste a header row plus at least one data row." };
  }
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { rows };
}

interface CsvProduct {
  itemName: string;
  brand: string;
  size: string;
  category: string;
  quantityInStock: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  batchNumber?: string | null;
  expiryDate?: Date | string | null;
  unitHierarchy?: { unitName: string; unitsPerParent: number }[] | null;
}

const CSV_HEADERS = [
  "itemName",
  "brand",
  "size",
  "category",
  "quantityInStock",
  "retailPrice",
  "wholesalePrice",
  "distributorPrice",
  "batchNumber",
  "expiryDate",
  "unitHierarchy",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function hierarchyToString(h?: { unitName: string; unitsPerParent: number }[] | null): string {
  if (!h || h.length === 0) return "";
  return h.map((l) => `${l.unitName}:${l.unitsPerParent}`).join(">");
}

function expiryToString(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * Same column set/order as the bulk-import template, so a downloaded deletion snapshot can be
 * re-uploaded through "Check file" as-is to restore the items it recorded.
 */
export function productsToCsv(products: CsvProduct[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const p of products) {
    lines.push(
      [
        p.itemName,
        p.brand,
        p.size,
        p.category,
        String(p.quantityInStock),
        String(p.retailPrice),
        String(p.wholesalePrice),
        String(p.distributorPrice),
        p.batchNumber || "",
        expiryToString(p.expiryDate),
        hierarchyToString(p.unitHierarchy),
      ]
        .map((v) => csvEscape(String(v)))
        .join(",")
    );
  }
  return lines.join("\n");
}
