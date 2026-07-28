"use client";

import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import * as pdfjsLib from "pdfjs-dist";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
}

type Phase = "define_headers" | "extracting_pdf" | "pdf_preview" | "scanning" | "review_scan" | "working_dataset" | "reupload_pdf";

type ExtractedPage = {
  id: number;
  thumbnail: string;
  status: "pending" | "processing" | "done" | "error";
  data?: any[];
  error?: string;
};

type InProgressJob = {
  _id: string;
  fileName: string;
  updatedAt: string;
};

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

  // Global Working Dataset
  const [workingDataset, setWorkingDataset] = useState<Record<string, string>[]>([]);
  const [pageCount, setPageCount] = useState(1);

  // PDF & Page States
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [extractedPages, setExtractedPages] = useState<ExtractedPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedRows, setScannedRows] = useState<Record<string, string>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [inProgressJobs, setInProgressJobs] = useState<InProgressJob[]>([]);
  const [resumingJob, setResumingJob] = useState<any>(null);

  // Load in-progress jobs on mount
  useEffect(() => {
    fetch("/api/inventory/scan-jobs")
      .then(res => res.json())
      .then(data => {
        if (data.jobs && data.jobs.length > 0) {
          setInProgressJobs(data.jobs);
        }
      })
      .catch(err => console.error("Failed to load jobs", err));
  }, []);

  async function saveJobProgress(updatedPages: ExtractedPage[], updatedDataset: any[]) {
    if (!jobId) return;
    try {
      await fetch(`/api/inventory/scan-jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: updatedPages, workingDataset: updatedDataset })
      });
    } catch (e) {
      console.error("Failed to save progress", e);
    }
  }

  async function resumeJob(id: string) {
    setScanError(null);
    setPhase("extracting_pdf");
    try {
      const res = await fetch(`/api/inventory/scan-jobs/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load job");
      
      const job = data.job;
      setJobId(job._id);
      setHeaders(job.headers);
      setWorkingDataset(job.workingDataset || []);
      setPageCount(job.pages.filter((p: any) => p.status === "done").length + 1);
      
      // Save the DB state to merge later after re-uploading the file locally
      setResumingJob(job);
      setPhase("reupload_pdf");
      
    } catch (err: any) {
      setScanError(err.message);
      setPhase("define_headers");
    }
  }

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

    if (file.size > 15 * 1024 * 1024) {
      alert("File is too large! Maximum file size is 15MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setScanError(null);
    setExtractedPages([]);
    setPdfDoc(null);
    setActivePageIndex(null);
    setJobId(null);
    setPhase("extracting_pdf");

    if (file.type === "application/pdf") {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfDoc(pdf);
        const total = pdf.numPages;
        
        const extracted: ExtractedPage[] = [];
        for (let i = 1; i <= total; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            
            // Merge with resumed job data if exists
            let initialStatus: any = "pending";
            let initialData: any = undefined;
            if (resumingJob && resumingJob.pages && resumingJob.pages.find((p:any) => p.id === i)) {
               const savedPage = resumingJob.pages.find((p:any) => p.id === i);
               initialStatus = savedPage.status;
               initialData = savedPage.data;
            }
            
            extracted.push({
              id: i,
              thumbnail: canvas.toDataURL("image/jpeg", 0.6),
              status: initialStatus,
              data: initialData
            });
          }
        }
        setExtractedPages(extracted);
        
        if (resumingJob && resumingJob.workingDataset && resumingJob.workingDataset.length > 0) {
           setPhase("working_dataset");
        } else {
           setPhase("pdf_preview");
        }

        // Upload to DB ONLY if it's a new job
        if (!resumingJob) {
          const res = await fetch("/api/inventory/scan-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              headers,
              pages: extracted
            })
          });
          const data = await res.json();
          if (data.job) setJobId(data.job._id);
        }
        setResumingJob(null);

      } catch (err: any) {
        setScanError("Failed to parse PDF: " + err.message);
        setPhase(workingDataset.length > 0 ? "working_dataset" : "define_headers");
      }
    } else {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const extracted: ExtractedPage[] = [{
          id: 1,
          thumbnail: base64,
          status: resumingJob ? resumingJob.pages[0]?.status || "pending" : "pending",
          data: resumingJob ? resumingJob.pages[0]?.data : undefined
        }];
        setExtractedPages(extracted);
        
        if (resumingJob && resumingJob.workingDataset && resumingJob.workingDataset.length > 0) {
           setPhase("working_dataset");
        } else {
           setPhase("pdf_preview");
        }
        
        // Upload to DB ONLY if it's a new job
        if (!resumingJob) {
          const res = await fetch("/api/inventory/scan-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              headers,
              pages: extracted
            })
          });
          const data = await res.json();
          if (data.job) setJobId(data.job._id);
        }
        setResumingJob(null);
      };
      reader.readAsDataURL(file);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function startScanningPage(pageIndex: number) {
    setActivePageIndex(pageIndex);
    setPhase("scanning");
    setScanError(null);

    const updated = [...extractedPages];
    updated[pageIndex].status = "processing";
    setExtractedPages(updated);
    if (jobId) saveJobProgress(updated, workingDataset);

    try {
      let base64String = extractedPages[pageIndex].thumbnail; // fallback
      
      if (pdfDoc) {
        const page = await pdfDoc.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          base64String = canvas.toDataURL("image/jpeg", 0.8);
        }
      }

      const res = await fetch("/api/inventory/scan-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64String, headers }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to scan image");
      }

      const normalizedRows = data.rows.map((row: any) => {
        const newRow: Record<string, string> = {};
        headers.forEach((h) => {
          let val = row[h] !== undefined ? String(row[h]) : "";
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
      
      const finished = [...extractedPages];
      finished[pageIndex].status = "done";
      finished[pageIndex].data = normalizedRows;
      setExtractedPages(finished);
      if (jobId) saveJobProgress(finished, workingDataset);
      
      setPhase("review_scan");

    } catch (err: any) {
      const errored = [...extractedPages];
      errored[pageIndex].status = "error";
      errored[pageIndex].error = err.message;
      setExtractedPages(errored);
      if (jobId) saveJobProgress(errored, workingDataset);
      
      setScanError(err.message);
      setPhase("review_scan");
    }
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
    const updatedPages = [...extractedPages];
    if (activePageIndex !== null) {
      updatedPages[activePageIndex].data = scannedRows;
      updatedPages[activePageIndex].status = "done";
      setExtractedPages(updatedPages);
    }

    let newDataset: Record<string, string>[] = [];
    let pagesProcessed = 0;

    updatedPages.forEach(page => {
      if (page.status === "done" && page.data && page.data.length > 0) {
        if (pagesProcessed > 0) {
          const separatorRow: Record<string, string> = {};
          headers.forEach(h => separatorRow[h] = "");
          separatorRow.itemName = `--- Page ${page.id} ---`;
          newDataset.push(separatorRow);
        }
        newDataset = [...newDataset, ...page.data];
        pagesProcessed++;
      }
    });

    setWorkingDataset(newDataset);
    setPageCount(pagesProcessed);

    // Save to DB
    if (activePageIndex !== null && jobId) {
      saveJobProgress(updatedPages, newDataset);
    }
    
    setScannedRows([]);
    setPhase("pdf_preview");
  }

  function discardScannedRows() {
    if (confirm("Are you sure you want to discard this page's extraction?")) {
      if (activePageIndex !== null) {
        const reset = [...extractedPages];
        reset[activePageIndex].status = "pending";
        reset[activePageIndex].error = undefined;
        reset[activePageIndex].data = undefined;
        setExtractedPages(reset);
        
        let newDataset: Record<string, string>[] = [];
        let pagesProcessed = 0;

        reset.forEach(page => {
          if (page.status === "done" && page.data && page.data.length > 0) {
            if (pagesProcessed > 0) {
              const separatorRow: Record<string, string> = {};
              headers.forEach(h => separatorRow[h] = "");
              separatorRow.itemName = `--- Page ${page.id} ---`;
              newDataset.push(separatorRow);
            }
            newDataset = [...newDataset, ...page.data];
            pagesProcessed++;
          }
        });

        setWorkingDataset(newDataset);
        setPageCount(pagesProcessed);

        if (jobId) saveJobProgress(reset, newDataset);
      }
      setScannedRows([]);
      setPhase("pdf_preview");
    }
  }

  function removeDatasetRow(rowIndex: number) {
    const newDataset = workingDataset.filter((_, i) => i !== rowIndex);
    setWorkingDataset(newDataset);
    if (jobId) saveJobProgress(extractedPages, newDataset);
    
    if (newDataset.length === 0) {
       setPhase("define_headers");
    }
  }

  function clearDataset() {
    if (confirm("Are you sure you want to clear the entire working document? This cannot be undone.")) {
      setWorkingDataset([]);
      if (jobId) saveJobProgress(extractedPages, []);
      setPhase("define_headers");
    }
  }

  async function exportToExcel() {
    if (workingDataset.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(workingDataset);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    XLSX.writeFile(workbook, `Inventory_Export_${new Date().toISOString().split("T")[0]}.xlsx`);
    
    // Delete job from DB on completion to save space
    if (jobId) {
      try {
        await fetch(`/api/inventory/scan-jobs/${jobId}`, { method: "DELETE" });
        setJobId(null);
        setInProgressJobs(inProgressJobs.filter(j => j._id !== jobId));
      } catch (e) {
        console.error("Failed to delete completed job", e);
      }
    }
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
            accept="image/*,.pdf"
            ref={fileInputRef}
            className="hidden"
            onChange={handleImageUpload}
          />
          <button
            onClick={() => {
              if (phase === "pdf_preview" && workingDataset.length > 0) {
                 setPhase("working_dataset");
              } else {
                 fileInputRef.current?.click();
              }
            }}
            disabled={phase === "scanning" || phase === "extracting_pdf" || (phase === "define_headers" && headers.length === 0)}
            className="bg-teal-700 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-teal-800 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === "pdf_preview" && workingDataset.length > 0 ? (
               <>
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                 View Compiled Excel
               </>
            ) : phase === "scanning" || phase === "extracting_pdf" ? (
              <span className="animate-pulse">Loading Document...</span>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Scan PDF or Image
              </>
            )}
          </button>
        </div>
      </div>

      {/* PHASE 1: Define Headers */}
      {(phase === "define_headers" || (phase === "working_dataset" && workingDataset.length === 0)) && (
        <div className="space-y-6">
          {inProgressJobs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 shadow-sm animate-in fade-in">
              <h2 className="text-lg font-bold text-amber-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                In-Progress Scans
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {inProgressJobs.map(job => (
                  <div key={job._id} onClick={() => resumeJob(job._id)} className="bg-white border border-amber-200 p-4 rounded-xl shadow-sm hover:shadow-md hover:border-amber-400 cursor-pointer transition-all flex justify-between items-center group">
                    <div className="truncate">
                      <p className="font-bold text-zinc-900 truncate" title={job.fileName}>{job.fileName}</p>
                      <p className="text-xs text-zinc-500 mt-1">Last edited: {new Date(job.updatedAt).toLocaleDateString()}</p>
                    </div>
                    <div className="bg-amber-100 text-amber-800 p-2 rounded-lg group-hover:bg-amber-200 transition-colors shrink-0 ml-3">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                 Confirm & Upload Document →
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Extracting PDF Spinner */}
      {phase === "extracting_pdf" && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-12 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500 min-h-[400px]">
          <div className="w-16 h-16 border-4 border-teal-100 border-t-teal-700 rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-bold text-zinc-900">Processing Document...</h2>
          <p className="text-zinc-500 mt-2 max-w-md text-center">Loading PDF from database or breaking down into images.</p>
        </div>
      )}

      {/* Re-Upload PDF Screen for Resumed Jobs */}
      {phase === "reupload_pdf" && resumingJob && (
        <div className="bg-white border border-teal-200 rounded-2xl shadow-sm p-12 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500 min-h-[400px]">
          <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-900">Resume: {resumingJob.fileName}</h2>
          <p className="text-zinc-500 mt-2 max-w-md text-center">To securely resume this scan without re-running the AI, please re-upload the exact same PDF file you used initially.</p>
          <div className="mt-8 flex gap-4">
             <button
               onClick={() => {
                 setResumingJob(null);
                 setJobId(null);
                 setPhase("define_headers");
               }}
               className="bg-zinc-100 text-zinc-700 px-6 py-2.5 rounded-xl font-bold hover:bg-zinc-200 transition-colors"
             >
               Cancel Resume
             </button>
             <button
               onClick={() => fileInputRef.current?.click()}
               className="bg-teal-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-sm hover:bg-teal-700 transition-colors"
             >
               Select File to Resume
             </button>
          </div>
        </div>
      )}

      {/* PHASE: PDF Preview Grid */}
      {phase === "pdf_preview" && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
          <div className="bg-zinc-50 border-b border-zinc-200 p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Document Breakdown</h2>
              <p className="text-sm text-zinc-500 mt-1">Select a page below to run the AI extraction, or review processed pages.</p>
            </div>
            {workingDataset.length > 0 && (
              <button
                onClick={() => setPhase("working_dataset")}
                className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-zinc-800 transition-colors"
              >
                View Compiled Excel ({workingDataset.length} rows)
              </button>
            )}
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {extractedPages.map((page, idx) => (
                <div key={idx} className="flex flex-col group">
                  <div 
                    onClick={() => {
                      if (page.status === "done") {
                        setScannedRows(page.data || []);
                        setActivePageIndex(idx);
                        setPhase("review_scan");
                      } else {
                        startScanningPage(idx);
                      }
                    }}
                    className={`relative aspect-[3/4] rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                      page.status === "done" ? "border-green-500 ring-4 ring-green-500/20" : 
                      page.status === "processing" ? "border-teal-500 ring-4 ring-teal-500/20 opacity-80" : 
                      page.status === "error" ? "border-red-500 ring-4 ring-red-500/20" :
                      "border-zinc-200 hover:border-teal-400 hover:shadow-lg"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={page.thumbnail} alt={`Page ${page.id}`} className="w-full h-full object-cover bg-zinc-100" />
                    
                    {page.status === "done" && (
                      <div className="absolute inset-0 bg-green-900/10 flex flex-col items-center justify-center backdrop-blur-[1px]">
                         <div className="bg-green-500 text-white p-2 rounded-full shadow-lg">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                         </div>
                      </div>
                    )}
                    {page.status === "error" && (
                      <div className="absolute inset-0 bg-red-900/10 flex flex-col items-center justify-center backdrop-blur-[1px]">
                         <div className="bg-red-500 text-white p-2 rounded-full shadow-lg">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                         </div>
                      </div>
                    )}
                    
                    {page.status === "pending" && (
                      <div className="absolute inset-0 bg-teal-900/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                         <span className="bg-white text-teal-900 font-bold px-4 py-2 rounded-lg text-sm shadow-xl transform scale-95 group-hover:scale-100 transition-transform">
                           Process Page
                         </span>
                      </div>
                    )}
                    {page.status === "done" && (
                      <div className="absolute inset-0 bg-green-900/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                         <span className="bg-white text-green-900 font-bold px-4 py-2 rounded-lg text-sm shadow-xl transform scale-95 group-hover:scale-100 transition-transform">
                           Edit Data
                         </span>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-bold text-zinc-700 text-sm">Page {page.id}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      page.status === "done" ? "bg-green-100 text-green-700" :
                      page.status === "processing" ? "bg-teal-100 text-teal-700" :
                      page.status === "error" ? "bg-red-100 text-red-700" :
                      "bg-zinc-100 text-zinc-500"
                    }`}>
                      {page.status === "done" ? "Complete" :
                       page.status === "processing" ? "Analyzing..." :
                       page.status === "error" ? "Failed" : "Pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PHASE: Scanning Single Page Overlay */}
      {phase === "scanning" && activePageIndex !== null && (
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-12 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500 min-h-[400px]">
          <div className="w-16 h-16 border-4 border-teal-100 border-t-teal-700 rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-bold text-zinc-900">
            Analyzing Page {extractedPages[activePageIndex].id}...
          </h2>
          <p className="text-zinc-500 mt-2 max-w-md text-center">Gemini Vision is currently mapping the handwritten or printed text to your defined columns. This usually takes 5-10 seconds.</p>
        </div>
      )}

      {/* PHASE 3: Review Scan */}
      {phase === "review_scan" && activePageIndex !== null && (
        <div className="bg-white border border-teal-200 rounded-2xl shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-500 ring-4 ring-teal-500/10">
          <div className="bg-teal-700 p-6 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20 shadow-md">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Scan Complete: Review Page {extractedPages[activePageIndex].id}
              </h2>
              <p className="text-teal-100 text-sm mt-1 font-medium">Please verify the AI extraction. Fix any errors or fill missing gaps below.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={discardScannedRows}
                className="bg-white/20 text-white hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                Discard & Back to Grid
              </button>
              <button
                onClick={confirmScannedRows}
                disabled={!!scanError}
                className="bg-white text-teal-900 hover:bg-teal-50 px-5 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors disabled:opacity-50"
              >
                Confirm & Save Progress
              </button>
            </div>
          </div>

          {scanError ? (
            <div className="p-16 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Error Processing Page {extractedPages[activePageIndex].id}</h3>
              <p className="text-zinc-500 max-w-md mb-8">{scanError}</p>
              
              <div className="flex gap-4">
                <button
                  onClick={() => startScanningPage(activePageIndex)}
                  className="bg-teal-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-sm hover:bg-teal-700 transition-colors"
                >
                  Retry Page {extractedPages[activePageIndex].id}
                </button>
                <button
                  onClick={discardScannedRows}
                  className="bg-zinc-100 text-zinc-700 px-6 py-2.5 rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                >
                  Back to Grid
                </button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
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
              {extractedPages.length > 0 && (
                <button
                  onClick={() => setPhase("pdf_preview")}
                  className="bg-white border border-zinc-300 text-zinc-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-50 transition-colors flex items-center gap-2 mr-4"
                >
                  ← Back to PDF Grid
                </button>
              )}
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                Scan New Document
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
