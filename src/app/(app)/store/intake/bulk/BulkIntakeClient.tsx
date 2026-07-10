"use client";

import { useState } from "react";
import { parseCsv } from "@/lib/csv";
import BackButton from "@/components/BackButton";

const BULK_FIELDS = [
  "itemName",
  "brand",
  "size",
  "category",
  "unitHierarchy",
  "receivedForm",
  "receivedQuantity",
  "purchaseAmount",
  "supplierName",
  "batchNumber",
  "expiryDate",
] as const;

const BULK_TEMPLATE =
  "itemName,brand,size,category,unitHierarchy,receivedForm,receivedQuantity,purchaseAmount,supplierName,batchNumber,expiryDate\n" +
  "Ibuprofen,GSK,200mg,medicine,carton:1>box:4>pack:10,carton,5,25000,ABC Distributors,IBU-01,2027-01-31\n" +
  "Groundnut oil,Mamador,1L,non-medicine,carton:1>bottle:12,carton,10,320000,,,";

export default function BulkIntakeClient({ initialStoreId }: { initialStoreId: string }) {
  const [storeId] = useState(initialStoreId);
  const [bulkText, setBulkText] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ received: number; errors: { row: number; error: string }[] } | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    setFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name);

    try {
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        setBulkText(XLSX.utils.sheet_to_csv(firstSheet));
      } else {
        setBulkText(await file.text());
      }
    } catch {
      setError("Couldn't read that file — make sure it's a valid CSV or Excel (.xlsx) file.");
    }
  }

  async function submitBulk() {
    setError(null);
    setResult(null);
    if (!storeId) {
      setError("No store selected — go back to the Bulk Store dashboard and open this from there.");
      return;
    }

    const { rows, error: parseError } = parseCsv(bulkText);
    if (parseError) {
      setError(parseError);
      return;
    }

    const bulkRows = rows.map((row) => {
      const out: Record<string, string> = {};
      BULK_FIELDS.forEach((field) => {
        out[field] = row[field.toLowerCase()] ?? "";
      });
      return out;
    });

    setSubmitting(true);
    const res = await fetch("/api/store-intake/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, rows: bulkRows }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok && !data.received) {
      setError(data.error || "Bulk receive failed");
      return;
    }

    setResult({ received: data.received, errors: data.errors || [] });
    if ((data.errors || []).length === 0) {
      setBulkText("");
      setFileName("");
    }
  }

  return (
    <div>
      <BackButton fallbackHref={storeId ? `/store/intake?storeId=${storeId}` : "/store"} />
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Bulk receive stock</h1>

      <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-sm text-zinc-600">
          Paste CSV with a header row:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">{BULK_FIELDS.join(",")}</code>. itemName,
          brand, size, unitHierarchy, receivedForm, receivedQuantity, and purchaseAmount are required for every
          row. category defaults to &quot;supermarket&quot; if left blank. unitHierarchy uses the format{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">carton:1&gt;box:4&gt;piece:10</code> (largest
          to smallest) — receivedForm must be one of those unit names. supplierName, batchNumber, and
          expiryDate (YYYY-MM-DD) are optional.
        </p>
        <p className="mb-2 text-sm text-zinc-600">
          Unlike the retail catalog, there&apos;s no duplicate check here — receiving an item that&apos;s
          already in this store just adds a new batch to it, which is normal. Rows with missing or invalid
          data are skipped and reported below; everything else still goes in.
        </p>

        <div className="mb-3 flex items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileSelected}
            className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-50"
          />
          <span className="text-xs text-zinc-400">or paste CSV directly below</span>
        </div>
        {fileName && <p className="mb-2 text-xs text-zinc-500">Loaded: {fileName}</p>}

        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={8}
          placeholder={BULK_TEMPLATE}
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        {result && (
          <div className="mb-3 text-sm">
            <p className="text-teal-700">
              Received {result.received} row{result.received === 1 ? "" : "s"}.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-red-600">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          onClick={submitBulk}
          disabled={submitting || !bulkText.trim()}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {submitting ? "Receiving..." : "Receive stock"}
        </button>
      </div>
    </div>
  );
}
