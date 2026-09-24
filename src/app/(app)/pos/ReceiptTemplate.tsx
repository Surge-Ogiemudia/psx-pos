"use client";

import React, { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getReceiptPaper, onReceiptPaperChange, type ReceiptPaper } from "@/lib/receiptPaper";

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
      <div className="print-receipt-root">
      {paper === "80" && (
        <style>{`@media print { @page { size: 80mm auto; margin: 0 !important; } .print-receipt { max-width: 72mm !important; } }`}</style>
      )}
      <div
        ref={ref}
        className="print-receipt"
        style={{
          width: "100%", 
          maxWidth: "55mm", // Standard 58mm thermal paper width limit
          padding: "0",
          margin: "0 auto",
          marginTop: "-5mm", // Slight negative margin to combat stubborn printer drivers
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
