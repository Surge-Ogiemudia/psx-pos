"use client";

import React, { forwardRef } from "react";

export interface ReceiptSale {
  _id: string;
  customerName?: string;
  userName?: string;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
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
}

const ReceiptTemplate = forwardRef<HTMLDivElement, ReceiptTemplateProps>(
  ({ sale, pharmacyName, branchName }, ref) => {
    const formattedDate = new Date(sale.timestamp).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div
        ref={ref}
        className="print-receipt"
        style={{
          width: "100%", 
          maxWidth: "80mm", // Standard thermal paper width limit on screen
          padding: "0",
          margin: "0 auto",
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: "12px",
          color: "#000",
          backgroundColor: "#fff",
          lineHeight: "1.4",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "15px" }}>
          <h2 style={{ margin: "0", fontSize: "16px", fontWeight: "bold" }}>{pharmacyName}</h2>
          {branchName && <p style={{ margin: "2px 0 0", fontSize: "12px" }}>{branchName}</p>}
          <p style={{ margin: "5px 0 0", fontSize: "12px" }}>Date: {formattedDate}</p>
          <p style={{ margin: "2px 0 0", fontSize: "12px" }}>Receipt: #{sale._id.slice(-6).toUpperCase()}</p>
          <p style={{ margin: "2px 0 0", fontSize: "12px" }}>Cashier: {sale.userName || "Admin"}</p>
        </div>

        <hr style={{ borderTop: "1px dashed #000", borderBottom: "none", margin: "10px 0" }} />

        {/* Items Header */}
        <div style={{ display: "flex", fontWeight: "bold", marginBottom: "5px" }}>
          <div style={{ flex: 1, textAlign: "left" }}>Item</div>
          <div style={{ width: "30px", textAlign: "center" }}>Qty</div>
          <div style={{ width: "60px", textAlign: "right" }}>Total</div>
        </div>

        <hr style={{ borderTop: "1px dashed #000", borderBottom: "none", margin: "5px 0 10px" }} />

        {/* Items List */}
        <div style={{ marginBottom: "10px" }}>
          {sale.items.map((item, idx) => (
            <div key={idx} style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: "bold" }}>{item.productName}</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>@{item.unitPrice.toLocaleString()}</span>
                <span>x{item.quantity}</span>
                <span style={{ fontWeight: "bold" }}>₦{item.lineTotal.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>

        <hr style={{ borderTop: "1px dashed #000", borderBottom: "none", margin: "10px 0" }} />

        {/* Totals */}
        <div style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "14px", marginBottom: "5px" }}>
            <span>TOTAL</span>
            <span>₦{sale.totalAmount.toLocaleString()}</span>
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Tendered</span>
            <span>₦{sale.amountTendered.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Change</span>
            <span>₦{sale.changeGiven.toLocaleString()}</span>
          </div>
        </div>

        <hr style={{ borderTop: "1px dashed #000", borderBottom: "none", margin: "10px 0" }} />

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "15px", fontSize: "11px" }}>
          <p style={{ margin: "0" }}>Thank you for your patronage!</p>
          <p style={{ margin: "5px 0 0" }}>Please call again.</p>
        </div>
      </div>
    );
  }
);

ReceiptTemplate.displayName = "ReceiptTemplate";

export default ReceiptTemplate;
