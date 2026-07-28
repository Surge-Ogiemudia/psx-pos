"use client";

import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";

type Phase = "define_headers" | "scanning" | "review_scan" | "working_dataset";

function generateRowSummary(row: Record<string, string>): string {
  const name = row.itemName || "Unknown Item";
  const size = row.size ? `${row.size} size.` : "";
  
  let hierarchyStr = "";
  if (row.unitHierarchy) {
    const parts = row.unitHierarchy.split(">");
    if (parts.length > 1) {
      const parent = parts[0].split(":")[0];
      const child = parts[1].split(":")[0];
      const qty = parts[1].split(":")[1] || "1";
      hierarchyStr = `Hierarchy: 1 ${parent} contains ${qty} ${child}s.`;
    } else {
      hierarchyStr = `Hierarchy: ${row.unitHierarchy}.`;
    }
  }

  let receivedStr = "";
  if (row.receivedQuantity && row.receivedForm) {
    receivedStr = `Received: ${row.receivedQuantity} ${row.receivedForm}(s).`;
  }
  
  let priceStr = "";
  if (row.purchaseAmount) {
    priceStr = `Paid ₦${row.purchaseAmount}.`;
  }

  return `${name}. ${size} ${hierarchyStr} ${receivedStr} ${priceStr}`.replace(/\s+/g, " ").trim();
}

export default function ScannerClient() {
  const [phase, setPhase] = useState<Phase>("define_headers");

  // Step 1: Define Headers
  const [headers, setHeaders] = useState<string[]>(["Item Name", "Quantity", "Unit Price"]);
  const [newHeader, setNewHeader] = useState("");

  // Step 2 & 3: Scanning and Review
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedRows, setScannedRows] = useState<Record<string, string>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global Working Dataset
  const [workingDataset, setWorkingDataset] = useState<Record<string, string>[]>([]);
  const [pageCount, setPageCount] = useState(1);

  // Load dataset from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem("inventory_creator_dataset");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWorkingDataset(parsed);
          const firstRow = parsed[0];
          setHeaders(Object.keys(firstRow));
          setPhase("working_dataset");
        }
      } catch (e) {
        console.error("Failed to parse saved dataset", e);
      }
    }
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem("inventory_creator_dataset", JSON.stringify(workingDataset));
  }, [workingDataset]);

  function addHeader() {
    const trimmed = newHeader.trim();
    if (trimmed && !headers.includes(trimmed)) {
      setHeaders([...headers, trimmed]);
    }
    setNewHeader("");
  }

  function removeHeader(idx: number) {
    setHeaders(headers.filter((_, i) => i !== idx));
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert file to base64
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;

      setIsScanning(true);
      setScanError(null);
      setPhase("scanning");

      try {
        const res = await fetch("/api/inventory/scan-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64String, headers }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to scan image");
        }

        // Initialize any missing headers in the response with empty strings
        const normalizedRows = data.rows.map((row: any) => {
          const newRow: Record<string, string> = {};
          headers.forEach((h) => {
            let val = row[h] !== undefined ? String(row[h]) : "";
            
            // Auto-fill logic
            if (!val && h === "brand" && row["itemName"]) {
              val = String(row["itemName"]).split(" ")[0] || "";
            }
            if (!val && h === "purchaseAmount") {
              val = "0";
            }
            
            newRow[h] = val;
          });
          return newRow;
        });

        setScannedRows(normalizedRows);
        setPhase("review_scan");
      } catch (error: any) {
        setScanError(error.message);
        setPhase(workingDataset.length > 0 ? "working_dataset" : "define_headers");
      } finally {
        setIsScanning(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  function updateScannedRow(rowIndex: number, colKey: string, val: string) {
    const newRows = [...scannedRows];
    newRows[rowIndex] = { ...newRows[rowIndex], [colKey]: val };
    setScannedRows(newRows);
  }

  function addEmptyScannedRow() {
    const newRow: Record<string, string> = {};
    headers.forEach((h) => (newRow[h] = ""));
    setScannedRows([...scannedRows, newRow]);
  }

  function removeScannedRow(rowIndex: number) {
    setScannedRows(scannedRows.filter((_, i) => i !== rowIndex));
  }

  function confirmScannedRows() {
    if (workingDataset.length > 0) {
      const separatorRow: Record<string, string> = {};
      headers.forEach(h => separatorRow[h] = "");
      separatorRow.itemName = `--- Page ${pageCount + 1} ---`;
      setWorkingDataset([...workingDataset, separatorRow, ...scannedRows]);
      setPageCount(prev => prev + 1);
    } else {
      setWorkingDataset([...scannedRows]);
    }
    setScannedRows([]);
    setPhase("working_dataset");
  }

  function discardScannedRows() {
    if (confirm("Are you sure you want to discard this scanned data?")) {
      setScannedRows([]);
      setPhase(workingDataset.length > 0 ? "working_dataset" : "define_headers");
    }
  }

  function removeDatasetRow(rowIndex: number) {
    setWorkingDataset(workingDataset.filter((_, i) => i !== rowIndex));
    if (workingDataset.length === 1) { // if this was the last row
       setPhase("define_headers");
    }
  }

  function clearDataset() {
    if (confirm("Are you sure you want to clear the entire working document? This cannot be undone.")) {
      setWorkingDataset([]);
      setPhase("define_headers");
    }
  }

  function exportToExcel() {
    if (workingDataset.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(workingDataset);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    XLSX.writeFile(workbook, `Inventory_Export_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 tracking-tight">AI Inventory Digitizer</h1>
          <p className="text-sm text-zinc-500 mt-1">Convert photos of handwritten or printed stock sheets into Excel instantly.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/store"
            className="px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors border border-zinc-200"
          >
            Exit to Store
          </Link>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handleImageUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isScanning || phase === "define_headers" && headers.length === 0}
            className="bg-teal-700 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-teal-800 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScanning ? (
              <span className="animate-pulse">Analyzing Image...</span>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Scan New Image
              </>
            )}
          </button>
        </div>
      </div>

      {scanError && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl text-sm flex items-center gap-2">
          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span className="font-medium">Scan failed: {scanError}</span>
        </div>
      )}

      {/* PHASE 1: Define Headers */}
      {(phase === "define_headers" || (phase === "working_dataset" && workingDataset.length === 0)) && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
          <div className="bg-zinc-50 border-b border-zinc-200 p-6">
            <h2 className="text-lg font-bold text-zinc-900">Step 1: Define Document Columns</h2>
            <p className="text-sm text-zinc-500 mt-1">What headers are written on the inventory sheet you are about to scan?</p>
          </div>
          <div className="p-6">
            <div className="flex flex-wrap gap-2 mb-6">
              {headers.map((h, idx) => (
                <div key={idx} className="bg-teal-50 border border-teal-200 text-teal-800 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2">
                  {h}
                  <button onClick={() => removeHeader(idx)} className="text-teal-600 hover:text-teal-900 ml-1">
                    ✕
                  </button>
                </div>
              ))}
            </div>
            
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full max-w-sm">
                <input
                  type="text"
                  placeholder="e.g. Expiry Date"
                  value={newHeader}
                  onChange={(e) => setNewHeader(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addHeader()}
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all shadow-sm"
                />
                <button
                  onClick={addHeader}
                  disabled={!newHeader.trim()}
                  className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Add Column
                </button>
              </div>
              <button
                onClick={() => setHeaders([
                  "itemName", "brand", "size", "category", "unitHierarchy", 
                  "receivedForm", "receivedQuantity", "purchaseAmount", "supplierName", 
                  "batchNumber", "expiryDate", "priceForm", "sisterStorePrice", 
                  "branchPrice", "distributorPrice", "wholesalerPrice", "retailerPrice"
                ])}
                className="text-sm font-semibold text-zinc-600 border border-zinc-300 px-4 py-2 rounded-lg hover:bg-zinc-100 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                Load Bulk Receive Defaults
              </button>
            </div>
          </div>
          <div className="bg-zinc-50 border-t border-zinc-100 p-6 flex justify-end">
             <button
               onClick={() => fileInputRef.current?.click()}
               disabled={headers.length === 0}
               className="bg-teal-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-teal-800 hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
             >
               Confirm & Scan First Page →
             </button>
          </div>
        </div>
      )}

      {/* PHASE 2: Scanning Overlay */}
      {phase === "scanning" && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-12 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500 min-h-[400px]">
          <div className="w-16 h-16 border-4 border-teal-100 border-t-teal-700 rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-bold text-zinc-900">Analyzing Image using AI...</h2>
          <p className="text-zinc-500 mt-2 max-w-md text-center">Gemini Vision is currently mapping the handwritten or printed text to your defined columns. This usually takes 5-10 seconds.</p>
        </div>
      )}

      {/* PHASE 3: Review Scan */}
      {phase === "review_scan" && (
        <div className="bg-white border border-teal-200 rounded-2xl shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-500 ring-4 ring-teal-500/10">
          <div className="bg-teal-700 p-6 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20 shadow-md">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Scan Complete: Review Data
              </h2>
              <p className="text-teal-100 text-sm mt-1 font-medium">Please verify the AI extraction. Fix any errors or fill missing gaps below.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={discardScannedRows}
                className="bg-white/20 text-white hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                Discard Scan
              </button>
              <button
                onClick={confirmScannedRows}
                className="bg-white text-teal-900 hover:bg-teal-50 px-5 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors"
              >
                Confirm & Append Data
              </button>
            </div>
          </div>

          <div className="overflow-x-auto pb-4">
            <table className="w-full text-left text-sm border-collapse min-w-max">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="w-12 min-w-[48px] px-3 py-3 text-center text-zinc-400 sticky left-0 z-10 bg-zinc-50 border-r border-zinc-200">#</th>
                  {headers.map((h, i) => {
                    let widthClass = "min-w-[150px]";
                    let stickyClass = "";
                    if (h === "itemName") {
                      widthClass = "min-w-[250px]";
                      stickyClass = "sticky left-[48px] z-10 bg-zinc-50 border-r border-zinc-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]";
                    }
                    if (h === "receivedQuantity") widthClass = "min-w-[80px]";
                    if (h === "size" || h === "category" || h === "purchaseAmount") widthClass = "min-w-[100px]";
                    if (h === "unitHierarchy") widthClass = "min-w-[200px]";

                    return (
                      <th key={i} className={`px-4 py-3 font-bold text-zinc-700 whitespace-nowrap ${widthClass} ${stickyClass}`}>
                        {h}
                      </th>
                    );
                  })}
                  <th className="w-16 min-w-[80px] px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {scannedRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-zinc-50/50 transition-colors group">
                    <td className="px-3 py-3 text-center text-zinc-400 font-mono text-xs sticky left-0 z-10 bg-white group-hover:bg-zinc-50/50 border-r border-zinc-200">
                      {rIdx + 1}
                    </td>
                    {headers.map((colKey, cIdx) => {
                      const isItemName = colKey === "itemName";
                      const stickyClass = isItemName ? "sticky left-[48px] z-10 bg-white group-hover:bg-zinc-50/50 border-r border-zinc-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" : "";
                      return (
                        <td key={cIdx} className={`px-2 py-2 ${stickyClass}`}>
                          <input
                            type="text"
                            value={row[colKey] || ""}
                            onChange={(e) => updateScannedRow(rIdx, colKey, e.target.value)}
                            className={`w-full bg-transparent border border-transparent hover:border-zinc-300 focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500 rounded px-3 py-2 transition-all outline-none font-medium ${
                              !row[colKey] ? "bg-zinc-100/50 placeholder:text-zinc-400" : "text-zinc-900"
                            }`}
                            placeholder="—"
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => removeScannedRow(rIdx)}
                        className="text-zinc-400 hover:text-red-600 transition-colors p-1"
                        title="Delete Row"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-zinc-50 border-t border-zinc-200 p-3 flex justify-center">
            <button
              onClick={addEmptyScannedRow}
              className="text-sm font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
            >
              <span>+</span> Add Missing Row
            </button>
          </div>
        </div>
      )}

      {/* PHASE 4: Global Working Dataset */}
      {phase === "working_dataset" && workingDataset.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300 flex flex-col h-[calc(100vh-160px)] min-h-[500px]">
          <div className="bg-zinc-50 border-b border-zinc-200 p-5 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Compiled Inventory Document</h2>
              <p className="text-sm text-zinc-500 mt-0.5">
                Total Items: <span className="font-bold text-zinc-900">{workingDataset.length}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={clearDataset}
                className="text-sm font-semibold text-red-600 hover:text-red-700 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
              >
                Clear All Data
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white border border-teal-200 text-teal-700 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-teal-50 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Scan Next Page
              </button>
              <button
                onClick={exportToExcel}
                className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export Final Excel (.xlsx)
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm relative">
              <thead className="bg-white border-b border-zinc-200 sticky top-0 shadow-sm z-10">
                <tr>
                  <th className="w-12 px-3 py-3 text-center text-zinc-400 bg-white">#</th>
                  <th className="px-4 py-3 font-bold text-zinc-700 whitespace-nowrap bg-white w-1/4">Item Name</th>
                  <th className="px-4 py-3 font-bold text-zinc-700 bg-white w-full">Summary</th>
                  <th className="w-16 px-4 py-3 text-center bg-white">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {workingDataset.map((row, rIdx) => {
                  const isSeparator = row.itemName?.startsWith("--- Page ");
                  if (isSeparator) {
                    return (
                      <tr key={rIdx} className="bg-zinc-100 border-y border-zinc-200">
                        <td colSpan={4} className="px-4 py-4 text-center">
                          <span className="font-bold text-zinc-600 tracking-wider text-sm uppercase">
                            {row.itemName}
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={rIdx} className="hover:bg-zinc-50 transition-colors group">
                      <td className="px-3 py-3 text-center text-zinc-400 font-mono text-xs align-top">{rIdx + 1}</td>
                      <td className="px-4 py-3 text-zinc-800 font-semibold align-top">{row.itemName || "—"}</td>
                      <td className="px-4 py-3 text-zinc-600 text-sm align-top leading-relaxed">
                        {generateRowSummary(row)}
                        <div className="hidden group-hover:block mt-2 pt-2 border-t border-zinc-100 text-xs text-zinc-400">
                          {headers.filter(h => h !== 'itemName' && row[h]).map(h => (
                            <span key={h} className="mr-3 inline-block mb-1">
                              <strong className="text-zinc-500 font-medium">{h}:</strong> {row[h]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <button
                          onClick={() => removeDatasetRow(rIdx)}
                          className="text-zinc-300 hover:text-red-600 transition-colors p-1"
                          title="Delete Item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
