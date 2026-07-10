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
  "priceForm",
  "sisterStorePrice",
  "branchPrice",
  "distributorPrice",
  "wholesalerPrice",
  "retailerPrice",
] as const;

const BULK_TEMPLATE =
  "itemName,brand,size,category,unitHierarchy,receivedForm,receivedQuantity,purchaseAmount,supplierName,batchNumber,expiryDate,priceForm,sisterStorePrice,branchPrice,distributorPrice,wholesalerPrice,retailerPrice\n" +
  "Ibuprofen,GSK,200mg,medicine,carton:1>box:4>pack:10,carton,5,25000,ABC Distributors,IBU-01,2027-01-31,pack,5300,6800,5500,6000,7500\n" +
  "Groundnut oil,Mamador,1L,non-medicine,carton:1>bottle:12,carton,10,320000,,,,,bottle,,,,,";

const CHANNEL_LABELS: Record<string, string> = {
  sister_store: "sister-store",
  branch: "branch",
  distributor: "distributor",
  wholesaler: "wholesaler",
  retailer: "retailer",
};

interface BulkAnalysis {
  totalRows: number;
  willReceive: { count: number; newItems: number; existingItemBatches: number };
  priceCounts: Record<string, number>;
  errors: { row: number; error: string }[];
}

export default function BulkIntakeClient({ initialStoreId }: { initialStoreId: string }) {
  const [storeId] = useState(initialStoreId);
  const [bulkText, setBulkText] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [analysis, setAnalysis] = useState<BulkAnalysis | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [result, setResult] = useState<{ received: number; errors: { row: number; error: string }[] } | null>(null);

  function updateBulkText(text: string) {
    setBulkText(text);
    setAnalysis(null);
    setErrorsExpanded(false);
    setError(null);
    setResult(null);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    setAnalysis(null);
    setErrorsExpanded(false);
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

  function buildRows(): { rows: Record<string, string>[]; error?: string } {
    const { rows, error: parseError } = parseCsv(bulkText);
    if (parseError) return { rows: [], error: parseError };
    const bulkRows = rows.map((row) => {
      const out: Record<string, string> = {};
      BULK_FIELDS.forEach((field) => {
        out[field] = row[field.toLowerCase()] ?? "";
      });
      return out;
    });
    return { rows: bulkRows };
  }

  async function analyzeBulk() {
    setError(null);
    setResult(null);
    setAnalysis(null);
    setErrorsExpanded(false);
    if (!storeId) {
      setError("No store selected — go back to the Bulk Store dashboard and open this from there.");
      return;
    }

    const { rows, error: parseError } = buildRows();
    if (parseError) {
      setError(parseError);
      return;
    }

    setAnalyzing(true);
    try {
      const res = await fetch("/api/store-intake/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, rows, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't analyze that file");
        return;
      }
      setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  async function submitBulk() {
    setError(null);
    setResult(null);
    const { rows, error: parseError } = buildRows();
    if (parseError) {
      setError(parseError);
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/store-intake/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, rows }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok && !data.received) {
      setError(data.error || "Bulk receive failed");
      return;
    }

    setResult({ received: data.received, errors: data.errors || [] });
    setAnalysis(null);
    setErrorsExpanded(false);
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
          The last six columns set this batch&apos;s prices, exactly like the &quot;Set prices&quot; step you&apos;d
          otherwise do by hand after a single receive. priceForm is the unit all five prices below are quoted
          per (defaults to receivedForm if left blank). Each of sisterStorePrice, branchPrice, distributorPrice,
          wholesalerPrice, and retailerPrice is independently optional — leave one blank to skip setting that
          channel&apos;s price for this batch, same as leaving it unset by hand.
        </p>
        <p className="mb-2 text-sm text-zinc-600">
          Unlike the retail catalog, there&apos;s no duplicate check here — receiving an item that&apos;s
          already in this store just adds a new batch to it, which is normal.
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
          onChange={(e) => updateBulkText(e.target.value)}
          rows={8}
          placeholder={BULK_TEMPLATE}
          className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        {analysis && (
          <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 text-sm font-medium text-zinc-800">
              Checked {analysis.totalRows} row{analysis.totalRows === 1 ? "" : "s"} — here&apos;s what will happen
              if you proceed:
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="rounded border border-teal-200 bg-teal-50 p-2 text-teal-800">
                <strong>{analysis.willReceive.count}</strong> row{analysis.willReceive.count === 1 ? "" : "s"}{" "}
                will be received ({analysis.willReceive.newItems} new item
                {analysis.willReceive.newItems === 1 ? "" : "s"} to this store,{" "}
                {analysis.willReceive.existingItemBatches} new batch
                {analysis.willReceive.existingItemBatches === 1 ? "" : "es"} added to items already here).
              </li>
              <li className="rounded border border-zinc-200 bg-white p-2 text-zinc-700">
                Prices will be set for: {" "}
                {Object.entries(analysis.priceCounts)
                  .map(([channel, n]) => `${n} ${CHANNEL_LABELS[channel] ?? channel}`)
                  .join(", ")}
                . Any row that leaves a price column blank won&apos;t be pushable/sellable on that channel until
                someone sets it later.
              </li>
              {analysis.errors.length > 0 && (
                <li className="rounded border border-red-200 bg-red-50 p-2">
                  <button
                    onClick={() => setErrorsExpanded((v) => !v)}
                    className="text-left text-red-800 hover:underline"
                  >
                    <strong>{analysis.errors.length}</strong> row{analysis.errors.length === 1 ? "" : "s"} have
                    errors and won&apos;t be received ({errorsExpanded ? "hide" : "click to view"})
                  </button>
                  {errorsExpanded && (
                    <ul className="mt-2 list-disc pl-5 text-zinc-700">
                      {analysis.errors.map((e) => (
                        <li key={e.row}>
                          Row {e.row}: {e.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </ul>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={submitBulk}
                disabled={submitting || analysis.willReceive.count === 0}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {submitting
                  ? "Receiving..."
                  : analysis.willReceive.count === 0
                  ? "Nothing to receive"
                  : `Receive ${analysis.willReceive.count} row${analysis.willReceive.count === 1 ? "" : "s"} now`}
              </button>
              <button
                onClick={() => {
                  setAnalysis(null);
                  setErrorsExpanded(false);
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Go back and edit file
              </button>
            </div>
          </div>
        )}

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

        {!analysis && (
          <button
            onClick={analyzeBulk}
            disabled={analyzing || !bulkText.trim()}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {analyzing ? "Checking..." : "Check file"}
          </button>
        )}
      </div>
    </div>
  );
}
