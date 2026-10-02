"use client";

import { Fragment, useEffect, useState, useRef } from "react";
import type { ActivityLogJSON, PaymentMethod, RefundJSON, SaleJSON } from "@/lib/types";
import { parseNumeric } from "@/lib/numberInput";
import ReceiptTemplate, { ReceiptSale } from "../pos/ReceiptTemplate";
import ReceiptPrintOptions from "../pos/ReceiptPrintOptions";
import { setPosResume } from "@/lib/posResume";

const ACTIVITY_ACTION_LABEL: Record<string, string> = {
  product_create: "Added product",
  sell: "Sale completed",
  refund: "Refund processed",
  receive: "Received transfer",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile money / bank transfer",
};

interface ReportData {
  summary: { totalAmount: number; totalCost: number; grossProfit: number; saleCount: number; refundAmount: number; refundCost: number; refundCount: number; netAmount: number; netCost: number; };
  byDay: { date: string; totalAmount: number; totalCost: number; grossProfit: number; saleCount: number }[];
  byMethod: { method: PaymentMethod; salesIn: number; refundsOut: number; changeOut: number; netCash: number }[];
  feeIncome: number;
  byStaff: { userId: string; userName: string; totalAmount: number; totalCost: number; grossProfit: number; saleCount: number }[];
}

export default function ReportsClient({ 
  branchId,
  pharmacyName,
  branchName,
  branchAddress,
  staffName,
}: { 
  branchId: string | null;
  pharmacyName: string;
  branchName: string;
  branchAddress: string;
  staffName?: string;
}) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [searchQuery, setSearchQuery] = useState("");
  // Collapsed by default — a sale with 100+ lines (wholesale) would otherwise make every row a
  // different, often huge, height. Only one open at a time, same as the Receipts page.
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [sales, setSales] = useState<SaleJSON[]>([]);
  const [refunds, setRefunds] = useState<RefundJSON[]>([]);

  const [reprintingSale, setReprintingSale] = useState<ReceiptSale | null>(null);
  const [reprintConfirmSale, setReprintConfirmSale] = useState<SaleJSON | null>(null);

  // Return Sale — same-day only (see the API route for why); older sales go through Refund.
  const [returnConfirmSale, setReturnConfirmSale] = useState<SaleJSON | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  function isToday(iso: string): boolean {
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  async function confirmReturnSale() {
    if (!returnConfirmSale || returning) return;
    setReturning(true);
    setReturnError(null);
    try {
      const res = await fetch(`/api/sales/${returnConfirmSale._id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not return this sale");
      setPosResume(data.items);
      window.location.href = "/pos";
    } catch (e) {
      setReturnError(e instanceof Error ? e.message : "Could not return this sale");
      setReturning(false);
    }
  }

  const [refundingSaleId, setRefundingSaleId] = useState<string | null>(null);
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  const [editingPaymentSale, setEditingPaymentSale] = useState<SaleJSON | null>(null);
  const [editPaymentLines, setEditPaymentLines] = useState<{ method: PaymentMethod; amount: string }[]>([]);
  const [editPaymentError, setEditPaymentError] = useState<string | null>(null);
  const [editPaymentSubmitting, setEditPaymentSubmitting] = useState(false);

  const [showActivity, setShowActivity] = useState(false);
  const [activityEntries, setActivityEntries] = useState<ActivityLogJSON[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const refundRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState<number>(0);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.target === topScrollRef.current && bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    } else if (e.target === bottomScrollRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  useEffect(() => {
    if (bottomScrollRef.current) {
      setTableWidth(bottomScrollRef.current.scrollWidth);
    }
  }, [sales]);

  useEffect(() => {
    if (refundingSaleId && refundRef.current) {
      refundRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [refundingSaleId]);

  async function loadActivity() {
    if (activityLoaded) return;
    const params = new URLSearchParams({ scope: "branch" });
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/activity-log?${params}`);
    if (res.ok) setActivityEntries((await res.json()).entries || []);
    setActivityLoaded(true);
  }

  async function load() {
    const params = new URLSearchParams({ from, to });
    if (branchId) params.set("branchId", branchId);
    const [reportRes, salesRes, refundsRes] = await Promise.all([
      fetch(`/api/reports?${params}`),
      fetch(`/api/sales?${params}`),
      fetch(`/api/refunds?${params}`),
    ]);
    if (reportRes.ok) setReport(await reportRes.json());
    if (salesRes.ok) setSales((await salesRes.json()).sales);
    if (refundsRes.ok) setRefunds((await refundsRes.json()).refunds);
  }

  useEffect(() => {
    const timeout = setTimeout(load, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId]);

  function refundedQuantity(saleId: string, productId: string): number {
    return refunds
      .filter((r) => r.saleId === saleId)
      .flatMap((r) => r.items)
      .filter((i) => i.productId === productId)
      .reduce((sum, i) => sum + i.quantity, 0);
  }

  function totalRefunded(saleId: string): number {
    return refunds.filter((r) => r.saleId === saleId).reduce((sum, r) => sum + r.totalAmount, 0);
  }

  function handleReprint(sale: SaleJSON) {
    const receiptSale: ReceiptSale = {
      _id: sale._id,
      receiptNumber: sale.receiptNumber,
      customerName: sale.customerName,
      userName: sale.userName,
      items: sale.items.map(i => ({
        productName: i.productName,
        quantity: i.formQuantity ?? i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        originalUnitPrice: i.originalUnitPrice,
        discountPercent: i.discountPercent,
      })),
      totalAmount: sale.totalAmount,
      payments: sale.payments,
      amountTendered: sale.amountTendered,
      changeGiven: sale.changeGiven,
      timestamp: sale.timestamp,
    };
    setReprintingSale(receiptSale);
    setTimeout(() => {
      window.print();
      setReprintingSale(null);
    }, 500);
  }

  function openRefund(sale: SaleJSON) {
    setRefundingSaleId(sale._id);
    setRefundReason("");
    setRefundError(null);
    setRefundQuantities({});
    const dominant = sale.payments.length
      ? sale.payments.reduce((max, p) => (p.amount > max.amount ? p : max), sale.payments[0])
      : null;
    setRefundMethod(dominant?.method ?? "cash");
  }

  function openEditPayment(sale: SaleJSON) {
    setEditingPaymentSale(sale);
    setEditPaymentError(null);
    setEditPaymentLines(
      sale.payments.map((p) => ({ method: p.method, amount: p.amount.toString() }))
    );
  }

  async function savePaymentMethod() {
    if (!editingPaymentSale) return;
    setEditPaymentSubmitting(true);
    setEditPaymentError(null);

    const parsedPayments = editPaymentLines.map((p) => ({
      method: p.method,
      amount: parseNumeric(p.amount) || 0,
    }));

    if (parsedPayments.some((p) => p.amount <= 0)) {
      setEditPaymentError("All payment amounts must be greater than 0.");
      setEditPaymentSubmitting(false);
      return;
    }

    const res = await fetch(`/api/sales/${editingPaymentSale._id}/payment-method`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payments: parsedPayments, branchId }),
    });

    const data = await res.json();
    setEditPaymentSubmitting(false);

    if (!res.ok) {
      setEditPaymentError(data.error || "Failed to update payment method.");
      return;
    }

    setEditingPaymentSale(null);
    await load();
  }

  async function submitRefund(sale: SaleJSON) {
    setRefundError(null);
    const items = sale.items
      .filter((line) => !line.isCustom && line.productId)
      .map((line) => ({
        productId: line.productId as string,
        quantity: parseNumeric(refundQuantities[line.productId as string] || 0),
      }))
      .filter((i) => i.quantity > 0);

    if (items.length === 0) {
      setRefundError("Enter a quantity to return for at least one item.");
      return;
    }

    setRefundSubmitting(true);
    const res = await fetch("/api/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId: sale._id, branchId, items, reason: refundReason, method: refundMethod }),
    });
    const data = await res.json();
    setRefundSubmitting(false);

    if (!res.ok) {
      setRefundError(data.error || "Refund failed.");
      return;
    }

    setRefundingSaleId(null);
    load();
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-zinc-900">Sales reports</h1>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => {
            const today = todayISO();
            setFrom(today);
            setTo(today);
          }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Today
        </button>
        <div className="ml-auto flex-1 min-w-[200px] max-w-sm">
          <label className="mb-1 block text-sm font-medium text-zinc-700">Search</label>
          <input
            type="search"
            placeholder="Search receipt #, item, staff, customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {report && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Gross sales</p>
            <p className="text-2xl font-bold text-zinc-900">₦{report.summary.totalAmount.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Refunds</p>
            <p className="text-2xl font-bold text-red-600">
              {report.summary.refundAmount > 0 ? "-" : ""}₦{report.summary.refundAmount.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Net sales</p>
            <p className="text-2xl font-bold text-zinc-900">₦{report.summary.netAmount.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Net Cost</p>
            <p className="text-2xl font-bold text-zinc-900">₦{report.summary.netCost.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-sm">
            <p className="text-sm text-orange-700">Gross Profit</p>
            <p className="text-2xl font-bold text-orange-700">₦{report.summary.grossProfit.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Transactions</p>
            <p className="text-2xl font-bold text-zinc-900">{report.summary.saleCount}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Change fee income</p>
            <p className="text-2xl font-bold text-teal-700">₦{report.feeIncome.toFixed(2)}</p>
          </div>
        </div>
      )}

      {report && (
        <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Refunded</th>
                <th className="px-3 py-2">Change given</th>
                <th className="px-3 py-2">Net cash position</th>
              </tr>
            </thead>
            <tbody>
              {report.byMethod.map((m) => (
                <tr key={m.method} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-zinc-900">{PAYMENT_METHOD_LABEL[m.method]}</td>
                  <td className="px-3 py-2">₦{m.salesIn.toFixed(2)}</td>
                  <td className="px-3 py-2">₦{m.refundsOut.toFixed(2)}</td>
                  <td className="px-3 py-2">₦{m.changeOut.toFixed(2)}</td>
                  <td className="px-3 py-2 font-medium text-zinc-900">₦{m.netCash.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && report.byStaff.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Transactions</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byStaff.map((s) => (
                <tr key={s.userId} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-zinc-900">{s.userName}</td>
                  <td className="px-3 py-2">{s.saleCount}</td>
                  <td className="px-3 py-2">₦{s.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && report.byDay.length > 1 && (
        <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Transactions</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byDay.map((day) => (
                <tr key={day.date} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2">{day.date}</td>
                  <td className="px-3 py-2">{day.saleCount}</td>
                  <td className="px-3 py-2">₦{day.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-base font-semibold text-zinc-900">Sale history</h2>
      {sales.length > 0 && (
        <div 
          ref={topScrollRef} 
          className="overflow-x-auto w-full mb-1 border border-zinc-200 rounded shadow-sm bg-white"
          onScroll={handleScroll}
        >
          <div style={{ width: tableWidth, height: '1px' }}></div>
        </div>
      )}

      <div 
        ref={bottomScrollRef}
        className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm"
        onScroll={handleScroll}
      >
        <table className="w-full text-left text-sm relative">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2 w-[100px] min-w-[100px] sticky left-0 z-20 bg-zinc-50 shadow-[1px_0_0_0_#e5e7eb]">Sale ID</th>
              <th className="px-3 py-2 w-[160px] min-w-[160px] sticky left-[100px] z-20 bg-zinc-50 shadow-[1px_0_0_0_#e5e7eb]">Time</th>
              <th className="px-3 py-2 w-[120px] min-w-[120px] sticky left-[260px] z-20 bg-zinc-50 shadow-[1px_0_0_0_#e5e7eb]">Staff</th>
              <th className="px-3 py-2 min-w-[300px] sticky left-[380px] z-20 bg-zinc-50 shadow-[1px_0_0_0_#e5e7eb] border-r border-zinc-200">Items</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.filter(sale => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return (
                (sale.receiptNumber && sale.receiptNumber.toLowerCase().includes(q)) ||
                (sale.userName && sale.userName.toLowerCase().includes(q)) ||
                (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
                (sale._id && sale._id.toLowerCase().includes(q)) ||
                sale.items.some(item => item.productName && item.productName.toLowerCase().includes(q))
              );
            }).map((sale) => {
              const refunded = totalRefunded(sale._id);
              const refundableLines = sale.items.filter((line) => !line.isCustom && line.productId);
              const fullyRefunded = refundableLines.every(
                (line) => refundedQuantity(sale._id, line.productId as string) >= line.quantity
              );
              const expanded = expandedSaleId === sale._id;
              return (
                <Fragment key={sale._id}>
                <tr className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500 w-[100px] min-w-[100px] sticky left-0 z-10 bg-white shadow-[1px_0_0_0_#f4f4f5]" title={sale._id}>
                    {sale.receiptNumber}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 w-[160px] min-w-[160px] sticky left-[100px] z-10 bg-white shadow-[1px_0_0_0_#f4f4f5]">{new Date(sale.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600 w-[120px] min-w-[120px] sticky left-[260px] z-10 bg-white shadow-[1px_0_0_0_#f4f4f5]">{sale.userName}</td>
                  <td className="px-3 py-2 text-zinc-600 min-w-[300px] sticky left-[380px] z-10 bg-white border-r border-zinc-100 shadow-[1px_0_0_0_#f4f4f5]">
                    <button
                      onClick={() => setExpandedSaleId((id) => (id === sale._id ? null : sale._id))}
                      className="text-left text-sm text-zinc-700 hover:text-zinc-900"
                    >
                      <span className="font-medium">
                        {sale.items.length} item{sale.items.length === 1 ? "" : "s"}
                      </span>
                      <span className="text-zinc-400"> — {sale.items.map((i) => i.productName).slice(0, 2).join(", ")}</span>
                      {sale.items.length > 2 && <span className="text-zinc-400"> +{sale.items.length - 2} more</span>}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {sale.payments.map((p) => `${PAYMENT_METHOD_LABEL[p.method]} ₦${p.amount.toFixed(2)}`).join(", ")}
                    {sale.changeGiven > 0 && (
                      <div className="text-xs text-zinc-400">
                        Change: ₦{sale.changeGiven.toFixed(2)}
                        {sale.changeFee > 0 ? ` (fee ₦${sale.changeFee.toFixed(2)})` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    ₦{sale.totalAmount.toFixed(2)}
                    {refunded > 0 && <div className="text-xs text-red-600">-₦{refunded.toFixed(2)} refunded</div>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setExpandedSaleId((id) => (id === sale._id ? null : sale._id))}
                      className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                    >
                      {expanded ? "Hide ▴" : "Details ▾"}
                    </button>
                  </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-zinc-100 bg-zinc-50/60">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="mb-3 flex flex-col gap-1.5">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => setReprintConfirmSale(sale)}
                              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                            >
                              🖨️ Reprint
                            </button>
                            <button
                              onClick={() => openEditPayment(sale)}
                              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              💳 Edit Payment
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {fullyRefunded ? (
                              <span className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-500">
                                Fully refunded
                              </span>
                            ) : (
                              <button
                                onClick={() => openRefund(sale)}
                                className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                              >
                                ↩️ Refund
                              </button>
                            )}
                            {isToday(sale.timestamp) && refunded === 0 && (
                              <button
                                onClick={() => setReturnConfirmSale(sale)}
                                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                              >
                                ⟲ Return Sale
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1.5 border-t border-zinc-200 pt-3">
                          {sale.items.map((i, idx) => {
                            const qty = i.formQuantity ?? i.quantity;
                            const qtySuffix = i.form ? ` ${i.form}${qty === 1 ? "" : "s"}` : "";
                            const cost = i.unitCost || 0;
                            const profit = i.unitPrice - cost;
                            return (
                              <div key={idx} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-zinc-100 pb-1.5 last:border-0 last:pb-0">
                                <span className="shrink-0 text-zinc-400">▸</span>
                                <span className="font-medium text-sm text-zinc-800">
                                  {i.productName}
                                  {!!i.discountPercent && (
                                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                      −{i.discountPercent}% DISCOUNT
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-zinc-500">Qty: <span className="font-medium text-zinc-700">{qty}{qtySuffix}</span></span>
                                <span className="text-xs text-zinc-500">Cost: <span className="font-medium text-zinc-700">₦{cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                                <span className="text-xs text-zinc-500">
                                  Sell:{" "}
                                  {!!i.discountPercent && i.originalUnitPrice != null && (
                                    <span className="text-zinc-400 line-through mr-1">
                                      ₦{i.originalUnitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                  <span className="font-medium text-zinc-700">
                                    ₦{i.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </span>
                                <span className="text-xs text-zinc-500">
                                  Profit: <span className={`font-medium ${profit >= 0 ? "text-orange-600" : "text-red-600"}`}>₦{profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  No sales in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {refundingSaleId &&
        (() => {
          const sale = sales.find((s) => s._id === refundingSaleId);
          if (!sale) return null;
          return (
            <div ref={refundRef} className="mt-4 max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">
                Refund sale from {new Date(sale.timestamp).toLocaleString()}
                <span className="ml-2 font-mono text-xs font-normal text-zinc-400" title={sale._id}>
                  #{sale.receiptNumber}
                </span>
              </h3>
              <div className="mb-3 flex flex-col gap-2">
                {sale.items
                  .filter((line) => !line.isCustom && line.productId)
                  .map((line) => {
                    const productId = line.productId as string;
                    const remaining = line.quantity - refundedQuantity(sale._id, productId);
                    if (remaining <= 0) return null;
                    return (
                      <div key={productId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-zinc-700">
                          {line.productName} — sold {line.quantity}, {remaining} returnable
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={refundQuantities[productId] || ""}
                          onChange={(e) =>
                            setRefundQuantities({ ...refundQuantities, [productId]: e.target.value })
                          }
                          className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                        />
                      </div>
                    );
                  })}
                {sale.items.some((line) => line.isCustom) && (
                  <p className="text-xs text-zinc-400">Custom (off-catalog) items in this sale aren&apos;t returnable here.</p>
                )}
              </div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Refund method</label>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Reason (optional)</label>
              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. customer changed their mind"
                className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              {refundError && <p className="mb-3 text-sm text-red-600">{refundError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setRefundingSaleId(null)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => submitRefund(sale)}
                  disabled={refundSubmitting}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {refundSubmitting ? "Processing..." : "Complete refund"}
                </button>
              </div>
            </div>
          );
        })()}

      {editingPaymentSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="flex w-full max-w-lg flex-col rounded-xl bg-white p-6 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Edit Payment Method</h3>
                <p className="text-xs text-zinc-500">Sale #{editingPaymentSale.receiptNumber} • Total ₦{editingPaymentSale.totalAmount.toFixed(2)}</p>
              </div>
              <button
                onClick={() => setEditingPaymentSale(null)}
                className="text-zinc-400 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Payment Breakdown
              </label>
              {editPaymentLines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={line.method}
                    onChange={(e) => {
                      const newMethod = e.target.value as PaymentMethod;
                      setEditPaymentLines((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, method: newMethod } : item))
                      );
                    }}
                    className="rounded border border-zinc-300 px-2 py-1.5 text-sm flex-1"
                  >
                    {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={line.amount}
                    onChange={(e) => {
                      const newAmount = e.target.value;
                      setEditPaymentLines((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, amount: newAmount } : item))
                      );
                    }}
                    className="w-28 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                  {editPaymentLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEditPaymentLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-xs text-red-600 hover:underline px-1"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setEditPaymentLines((prev) => [...prev, { method: "mobile_money", amount: "" }])
                }
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                + Add split payment line
              </button>

              {editPaymentError && (
                <p className="text-xs text-red-600 font-medium">{editPaymentError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => setEditingPaymentSale(null)}
                disabled={editPaymentSubmitting}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePaymentMethod}
                disabled={editPaymentSubmitting}
                className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 shadow-sm"
              >
                {editPaymentSubmitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <button
          onClick={() => {
            setShowActivity((v) => !v);
            if (!showActivity) loadActivity();
          }}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700"
        >
          <span>Activity — line-by-line log of what happened</span>
          <span>{showActivity ? "Hide" : "Show"}</span>
        </button>
        {showActivity && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 p-4">
            {activityEntries.map((entry) => (
              <div key={entry._id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                    {ACTIVITY_ACTION_LABEL[entry.action] || entry.action}
                  </span>
                  <span className="text-xs text-zinc-400">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm text-zinc-800">{entry.summary}</p>
                <p className="mt-1 text-xs text-zinc-500">{entry.actorName}</p>
              </div>
            ))}
            {activityLoaded && activityEntries.length === 0 && (
              <p className="text-sm text-zinc-500">Nothing has happened at this branch yet.</p>
            )}
          </div>
        )}
      </div>

      {reprintingSale && (
        <ReceiptTemplate
          sale={reprintingSale}
          pharmacyName={pharmacyName}
          branchName={branchName}
          branchAddress={branchAddress}
        />
      )}

      {reprintConfirmSale && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setReprintConfirmSale(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-zinc-900">Reprint receipt #{reprintConfirmSale.receiptNumber}</h2>
            <p className="mb-6 text-sm text-zinc-500">Check the printer settings, then print.</p>
            <ReceiptPrintOptions />
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const sale = reprintConfirmSale;
                  setReprintConfirmSale(null);
                  handleReprint(sale);
                }}
                className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"
              >
                Print
              </button>
              <button
                onClick={() => setReprintConfirmSale(null)}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {returnConfirmSale && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => !returning && setReturnConfirmSale(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-zinc-900">Return sale #{returnConfirmSale.receiptNumber}?</h2>
            <p className="mb-4 text-sm text-zinc-500">This will:</p>
            <ul className="mb-5 list-disc space-y-1.5 pl-5 text-sm text-zinc-700">
              <li>
                Remove <b>₦{returnConfirmSale.totalAmount.toFixed(2)}</b> from today&apos;s sales total
              </li>
              <li>
                Put all <b>{returnConfirmSale.items.length}</b> item{returnConfirmSale.items.length === 1 ? "" : "s"} back in
                stock
              </li>
              <li>Make receipt #{returnConfirmSale.receiptNumber} invalid — any printed copy no longer matches</li>
              <li>Take you to the cart with those items loaded, ready to edit and resell</li>
            </ul>
            {returnError && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{returnError}</p>
            )}
            <div className="flex flex-col gap-3">
              <button
                onClick={confirmReturnSale}
                disabled={returning}
                className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {returning ? "Returning…" : "Yes, return this sale"}
              </button>
              <button
                onClick={() => setReturnConfirmSale(null)}
                disabled={returning}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
