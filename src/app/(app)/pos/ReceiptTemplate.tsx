"use client";

import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getReceiptPaper,
  onReceiptPaperChange,
  type ReceiptPaper,
  getReceiptLongMode,
  onReceiptLongModeChange,
} from "@/lib/receiptPaper";

export interface ReceiptSale {
  _id: string;
  receiptNumber: string;
  customerName?: string;
  userName?: string;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    originalUnitPrice?: number | null;
    discountPercent?: number;
  }[];
  totalAmount: number;
  payments: { method: string; amount: number }[];
  amountTendered: number;
  changeGiven: number;
  timestamp: string;
}

// Sale lines store their name as "item · size · brand" (see formatProductLabel). The A4 table
// prints the brand in its own narrow column so the item column stays short enough for one line.
// Anything that doesn't follow that shape (e.g. a custom item) is printed whole.
function splitProductName(productName: string): { item: string; brand: string } {
  const parts = productName.split(" · ");
  if (parts.length >= 3) return { item: parts.slice(0, -1).join(" · "), brand: parts[parts.length - 1] };
  return { item: productName, brand: "" };
}

interface ReceiptTemplateProps {
  sale: ReceiptSale;
  pharmacyName: string;
  branchName?: string;
  branchAddress?: string;
}

const ReceiptTemplate = forwardRef<HTMLDivElement, ReceiptTemplateProps>(
  ({ sale, pharmacyName, branchName, branchAddress }, ref) => {
    const [paper, setPaper] = useState<ReceiptPaper>("58");
    useEffect(() => {
      setPaper(getReceiptPaper());
      return onReceiptPaperChange(() => setPaper(getReceiptPaper()));
    }, []);
    const [longMode, setLongMode] = useState(false);
    useEffect(() => {
      setLongMode(getReceiptLongMode());
      return onReceiptLongModeChange(() => setLongMode(getReceiptLongMode()));
    }, []);

    // The browser prints the page title ("PharmaStackX POS") in the top margin of A4 prints,
    // where there is a real margin for it. Blank it just for the print, then put it back.
    useEffect(() => {
      if (paper !== "A4") return;
      let original: string | null = null;
      const restore = () => {
        if (original !== null) {
          document.title = original;
          original = null;
        }
      };
      const blank = () => {
        // Guard: if the event ever fires twice before afterprint, don't overwrite the real title.
        if (original === null) original = document.title;
        document.title = "\u00A0";
      };
      window.addEventListener("beforeprint", blank);
      window.addEventListener("afterprint", restore);
      return () => {
        window.removeEventListener("beforeprint", blank);
        window.removeEventListener("afterprint", restore);
        restore();
      };
    }, [paper]);

    // Long mode only applies to the thermal (58/80mm) printers it was built for — A4 is a
    // fixed-length sheet a long receipt can't be stretched to fit onto in one page anyway, so
    // it just paginates normally there (see the A4 @page rule below) and skips all of this.
    const isLongMode = longMode && paper !== "A4";

    // Long mode: measure the ACTUAL rendered receipt and size @page to fit it exactly, instead
    // of guessing a fixed height. A guessed height that's too short reproduces the original
    // bug (still splits into extra sheets on a big enough wholesale cart); one that's too tall
    // wastes paper on every print, including short ones, since a fixed page height makes the
    // printer feed that whole length regardless of how much of it is actual content. Sizing to
    // the true content avoids both. Needs the receipt actually laid out (real width, real
    // wrapped line breaks) to measure correctly — see the root <div>'s style below.
    const innerRef = useRef<HTMLDivElement | null>(null);
    const [dynamicPageCss, setDynamicPageCss] = useState<string | null>(null);
    useLayoutEffect(() => {
      if (!isLongMode) {
        setDynamicPageCss(null);
        return;
      }
      const el = innerRef.current;
      if (!el) return;
      const PX_TO_MM = 25.4 / 96;
      const heightMm = Math.ceil(el.scrollHeight * PX_TO_MM) + 15; // small buffer for print-engine rounding
      setDynamicPageCss(`@page { size: ${paper}mm ${heightMm}mm; margin: 0 !important; }`);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLongMode, paper, sale]);

    const formattedDate = new Date(sale.timestamp).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Rendered straight under <body>, outside the POS layout, so printing can hide every other
    // body child with display:none. (Merely hiding the page with visibility left its full height
    // in the print job and produced many blank pages.)
    if (typeof document === "undefined") return null;
    const receiptBody = (
      <>
        {/* Header */}
        {paper === "A4" ? (
          // A4: the pharmacy name stands alone on top; everything else sits in a small grid,
          // three to a row (two rows at most) instead of one line each.
          <div style={{ marginBottom: "6px" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: "bold", color: "#000", textAlign: "center", textTransform: "uppercase" }}>{pharmacyName.toUpperCase()}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "11px", lineHeight: "1.25", color: "#000" }}>
              <tbody>
                {(() => {
                  const cells: { label: string; value: string; bold?: boolean }[] = [];
                  if (branchName) cells.push({ label: "Branch", value: branchName, bold: true });
                  cells.push({ label: "Date", value: formattedDate });
                  cells.push({ label: "Receipt", value: `#${sale.receiptNumber}` });
                  if (branchAddress) cells.push({ label: "Address", value: branchAddress });
                  cells.push({ label: "Staff", value: sale.userName || "Admin" });
                  if (sale.customerName) cells.push({ label: "Customer", value: sale.customerName, bold: true });
                  const rows: (typeof cells)[] = [];
                  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
                  return rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={c.label} colSpan={ci === row.length - 1 ? 4 - row.length : 1} style={{ border: "1px solid #000", padding: "2px 4px", verticalAlign: "top", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                          <span style={{ fontWeight: "normal" }}>{c.label}: </span>
                          <span style={{ fontWeight: c.bold ? "bold" : "normal" }}>{c.value}</span>
                        </td>
                      ))}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        ) : (
          <>
        <div style={{ textAlign: "center", marginBottom: "12px" }}>
          <h2 style={{ margin: "0", fontSize: "16px", fontWeight: "bold", color: "#000" }}>{pharmacyName}</h2>
          {branchName && <p style={{ margin: "2px 0 0", fontSize: "12px", fontWeight: "bold", color: "#000" }}>{branchName}</p>}
          {branchAddress && <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#000", whiteSpace: "pre-wrap" }}>{branchAddress}</p>}
          <p style={{ margin: "5px 0 0", fontSize: "12px", color: "#000" }}>Date: {formattedDate}</p>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#000" }}>Receipt: #{sale.receiptNumber}</p>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#000" }}>Staff: {sale.userName || "Admin"}</p>
          {sale.customerName && (
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#000" }}>Customer: {sale.customerName}</p>
          )}
        </div>
          </>
        )}

        {/* The A4 grids carry their own borders, so the dashed rule is thermal-only. */}
        {paper !== "A4" && <hr style={{ borderTop: "2px dashed #000", borderBottom: "none", margin: "8px 0" }} />}

        {paper === "A4" ? (
          // A4: an invoice-style grid, one line per item where it fits. The column header
          // repeats on every page of a long sale. Thermal layouts below are untouched.
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              fontSize: "11px",
              lineHeight: "1.2",
              color: "#000",
              marginBottom: "8px",
            }}
          >
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "40%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "13%" }} />
            </colgroup>
            <thead style={{ display: "table-header-group" }}>
              <tr>
                {["S/N", "Item", "Brand", "Qty", "Rate (N)", "Amount (N)"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      border: "1px solid #000",
                      padding: "2px 4px",
                      textAlign: i >= 3 ? "right" : "left",
                      fontWeight: "bold",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, idx) => {
                const { item: itemName, brand } = splitProductName(item.productName);
                const cell = { border: "1px solid #000", padding: "1px 4px", verticalAlign: "top" as const };
                return (
                  <tr key={idx} className="receipt-item-row">
                    <td style={{ ...cell, textAlign: "left" }}>{idx + 1}</td>
                    <td style={{ ...cell, fontWeight: "bold", wordBreak: "break-word" }}>
                      {itemName}
                      {!!item.discountPercent && (
                        <div style={{ fontSize: "9px", fontWeight: "bold" }}>
                          ** DISCOUNT -{item.discountPercent}%
                          {item.originalUnitPrice != null && ` (was N${item.originalUnitPrice.toLocaleString()})`} **
                        </div>
                      )}
                    </td>
                    <td style={{ ...cell, fontSize: "9px", wordBreak: "break-word" }}>{brand}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{item.quantity}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{item.unitPrice?.toLocaleString() || "0"}</td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: "bold" }}>{item.lineTotal?.toLocaleString() || "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <>
        {/* Items Header */}
        <div style={{ display: "flex", fontWeight: "bold", fontSize: "12px", color: "#000", marginBottom: "4px" }}>
          <div style={{ flex: 1, textAlign: "left" }}>Item</div>
          <div style={{ width: "30px", textAlign: "center" }}>Qty</div>
          <div style={{ width: "65px", textAlign: "right" }}>Total</div>
        </div>

        <hr style={{ borderTop: "2px dashed #000", borderBottom: "none", margin: "4px 0 8px" }} />

        {/* Items List */}
        <div style={{ marginBottom: "8px" }}>
          {sale.items.map((item, idx) => (
            <div key={idx} className="receipt-item-row" style={{ marginBottom: "6px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", width: "100%", color: "#000" }}>
                <div style={{ flex: 1, textAlign: "left", fontWeight: "bold", paddingRight: "4px", wordBreak: "break-word" }}>
                  {item.productName}
                </div>
                <div style={{ width: "30px", textAlign: "center", fontWeight: "bold" }}>
                  {item.quantity}
                </div>
                <div style={{ width: "65px", textAlign: "right", fontWeight: "bold" }}>
                  N{item.lineTotal?.toLocaleString() || "0"}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "#000" }}>
                @ N{item.unitPrice?.toLocaleString() || "0"}
                {!!item.discountPercent && item.originalUnitPrice != null && (
                  <span> (was N{item.originalUnitPrice.toLocaleString()})</span>
                )}
              </div>
              {!!item.discountPercent && (
                <div style={{ fontSize: "11px", fontWeight: "bold", color: "#000" }}>
                  ** DISCOUNT APPLIED: -{item.discountPercent}% **
                </div>
              )}
            </div>
          ))}
        </div>
          </>
        )}

        <hr style={{ borderTop: "2px dashed #000", borderBottom: "none", margin: "8px 0" }} />

        {/* Totals */}
        <div style={{ marginBottom: "8px", color: "#000" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }}>
            <span>TOTAL</span>
            <span>N{sale.totalAmount?.toLocaleString() || "0"}</span>
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
            <span>Tendered</span>
            <span>N{sale.amountTendered?.toLocaleString() || "0"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
            <span>Change</span>
            <span>N{sale.changeGiven?.toLocaleString() || "0"}</span>
          </div>

          {/* Payment Methods */}
          {sale.payments && sale.payments.length > 0 && (
            <div style={{ marginTop: "4px", paddingTop: "4px", borderTop: "1px dashed #000" }}>
              {sale.payments.map((p, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#000" }}>
                  <span style={{ textTransform: "capitalize" }}>Paid via {p.method.replace('_', ' ')}</span>
                  <span>N{p.amount?.toLocaleString() || "0"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr style={{ borderTop: "2px dashed #000", borderBottom: "none", margin: "8px 0" }} />

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "10px", fontSize: "11px", color: "#000" }}>
          <p style={{ margin: "0 0 5px", fontWeight: "bold" }}>Please no return of goods after payment</p>
          <p style={{ margin: "0" }}>Thank you for your patronage!</p>
          <p style={{ margin: "3px 0 0" }}>Please call again.</p>
        </div>
      </>
    );

    return createPortal(
      <div
        className="print-receipt-root"
        // In long mode the receipt needs to be genuinely laid out (not display:none) so its
        // real height can be measured above — kept off-screen here instead, only for devices
        // that opted into long mode; every other device keeps the plain display:none default
        // from globals.css untouched.
        style={
          isLongMode
            ? // width is the fix that matters here: without it this fixed-position box
              // shrinks-to-fit to something much wider than the real receipt, so text barely
              // wraps during measurement — the real (narrow) print then wraps onto far more
              // lines and comes out taller than what got measured, splitting again.
              { position: "fixed", top: 0, left: "-100000px", display: "block", width: `${paper}mm` }
            : undefined
        }
      >
      {paper === "80" && (
        // The width here is also set inline below (for on/off-screen measurement in long
        // mode), but globals.css's print rule sets max-width:55mm with !important, which
        // beats a plain inline style — this !important is what actually wins at print time.
        <style>{`@media print { @page { size: 80mm auto; margin: 0 !important; } .print-receipt-root .print-receipt { width: 100% !important; max-width: none !important; box-sizing: border-box !important; padding: 0 2mm !important; } }`}</style>
      )}
      {paper === "A4" && (
        // A fallback for a till whose thermal printer won't cooperate — same receipt, printed
        // on a normal office printer instead, with no attempt to force it onto one sheet: a long
        // receipt runs to page 2/3, same as any other document.
        // The page margin is 0 on purpose: browsers print their own header/footer (date, page
        // title, URL, page numbers) inside the page margin, and drop it when the margin is 0.
        // The breathing room is supplied by the spacer rows of the frame table below instead,
        // which repeat on every page.
        // Explicit mm dimensions, not the "A4" keyword — keyword page sizes are less reliably
        // supported than plain numbers, which is what every other working rule here uses.
        <style>{`@media print { @page { size: 210mm 297mm !important; margin: 0 !important; } .print-receipt-root .print-receipt { width: 100% !important; max-width: none !important; box-sizing: border-box !important; padding: 0 !important; margin-top: 0 !important; } .print-receipt-root .print-receipt * { page-break-inside: auto !important; } .print-receipt-root .print-receipt .receipt-item-row { page-break-inside: avoid !important; } .print-receipt-root .print-receipt thead { page-break-inside: avoid !important; break-inside: avoid !important; } }`}</style>
      )}
      {dynamicPageCss && <style>{`@media print { ${dynamicPageCss} }`}</style>}
      <div
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className="print-receipt"
        style={{
          width: "100%",
          maxWidth: paper === "A4" || paper === "80" ? "none" : "55mm", // thermal paper width, or fill whatever the page gives it (80mm/A4)
          boxSizing: "border-box",
          padding: paper === "80" ? "0 2mm" : "0",
          margin: "0 auto",
          marginTop: paper === "A4" ? "0" : "-5mm", // Slight negative margin to combat stubborn thermal printer drivers — not needed/wanted on A4
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "12px",
          color: "#000",
          backgroundColor: "#fff",
          lineHeight: "1.3",
        }}
      >
        {paper === "A4" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead style={{ display: "table-header-group" }}>
              <tr><td style={{ height: "3mm", padding: 0, border: 0 }} /></tr>
            </thead>
            <tbody>
              <tr><td style={{ padding: "0 15mm", border: 0, verticalAlign: "top" }}>{receiptBody}</td></tr>
            </tbody>
            <tfoot style={{ display: "table-footer-group" }}>
              <tr><td style={{ height: "4mm", padding: 0, border: 0 }} /></tr>
            </tfoot>
          </table>
        ) : (
          receiptBody
        )}
      </div>
      </div>,
      document.body
    );
  }
);

ReceiptTemplate.displayName = "ReceiptTemplate";

export default ReceiptTemplate;
