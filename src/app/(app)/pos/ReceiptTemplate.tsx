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
        // on a normal office printer instead. A real page with real margins, and no attempt to
        // force it onto one sheet: a long receipt runs to page 2/3, same as any other document.
        <style>{`@media print { @page { size: A4; margin: 15mm; } .print-receipt-root .print-receipt { width: 100% !important; max-width: 180mm !important; box-sizing: border-box !important; padding: 0 !important; margin-top: 0 !important; } }`}</style>
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
          maxWidth: paper === "A4" ? "180mm" : paper === "80" ? "none" : "55mm", // thermal paper width, or a normal printable A4 column
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
        {/* Header */}
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

        <hr style={{ borderTop: "2px dashed #000", borderBottom: "none", margin: "8px 0" }} />

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
            <div key={idx} style={{ marginBottom: "6px", display: "flex", flexDirection: "column" }}>
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
      </div>
      </div>,
      document.body
    );
  }
);

ReceiptTemplate.displayName = "ReceiptTemplate";

export default ReceiptTemplate;
