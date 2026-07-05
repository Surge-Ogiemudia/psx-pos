"use client";

import { useEffect, useState } from "react";
import type { PaymentMethod, RefundJSON, SaleJSON } from "@/lib/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile money / bank transfer",
};

interface ReportData {
  summary: { totalAmount: number; saleCount: number; refundAmount: number; refundCount: number; netAmount: number };
  byDay: { date: string; totalAmount: number; saleCount: number }[];
  byMethod: { method: PaymentMethod; salesIn: number; refundsOut: number; changeOut: number; netCash: number }[];
  feeIncome: number;
  byStaff: { userId: string; userName: string; totalAmount: number; saleCount: number }[];
}

export default function ReportsClient({ branchId }: { branchId: string | null }) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [report, setReport] = useState<ReportData | null>(null);
  const [sales, setSales] = useState<SaleJSON[]>([]);
  const [refunds, setRefunds] = useState<RefundJSON[]>([]);

  const [refundingSaleId, setRefundingSaleId] = useState<string | null>(null);
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("cash");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

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

  async function submitRefund(sale: SaleJSON) {
    setRefundError(null);
    const items = sale.items
      .map((line) => ({
        productId: line.productId,
        quantity: Number(refundQuantities[line.productId] || 0),
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
      </div>

      {report && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
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
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => {
              const refunded = totalRefunded(sale._id);
              const fullyRefunded = sale.items.every(
                (line) => refundedQuantity(sale._id, line.productId) >= line.quantity
              );
              return (
                <tr key={sale._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2 text-zinc-600">{new Date(sale.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {sale.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
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
                    {fullyRefunded ? (
                      <span className="text-xs text-zinc-400">Fully refunded</span>
                    ) : (
                      <button onClick={() => openRefund(sale)} className="text-teal-700 hover:underline">
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
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
            <div className="mt-4 max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">
                Refund sale from {new Date(sale.timestamp).toLocaleString()}
              </h3>
              <div className="mb-3 flex flex-col gap-2">
                {sale.items.map((line) => {
                  const remaining = line.quantity - refundedQuantity(sale._id, line.productId);
                  if (remaining <= 0) return null;
                  return (
                    <div key={line.productId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-zinc-700">
                        {line.productName} — sold {line.quantity}, {remaining} returnable
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        placeholder="0"
                        value={refundQuantities[line.productId] || ""}
                        onChange={(e) =>
                          setRefundQuantities({ ...refundQuantities, [line.productId]: e.target.value })
                        }
                        className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm"
                      />
                    </div>
                  );
                })}
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
    </div>
  );
}
