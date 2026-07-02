"use client";

import { useEffect, useState } from "react";
import type { SaleJSON } from "@/lib/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ReportData {
  summary: { totalAmount: number; saleCount: number };
  byDay: { date: string; totalAmount: number; saleCount: number }[];
}

export default function ReportsClient() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [report, setReport] = useState<ReportData | null>(null);
  const [sales, setSales] = useState<SaleJSON[]>([]);

  useEffect(() => {
    async function load() {
      const params = new URLSearchParams({ from, to });
      const [reportRes, salesRes] = await Promise.all([
        fetch(`/api/reports?${params}`),
        fetch(`/api/sales?${params}`),
      ]);
      if (reportRes.ok) setReport(await reportRes.json());
      if (salesRes.ok) setSales((await salesRes.json()).sales);
    }
    load();
  }, [from, to]);

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
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Total sales</p>
            <p className="text-2xl font-bold text-zinc-900">${report.summary.totalAmount.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-zinc-500">Transactions</p>
            <p className="text-2xl font-bold text-zinc-900">{report.summary.saleCount}</p>
          </div>
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
                  <td className="px-3 py-2">${day.totalAmount.toFixed(2)}</td>
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
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale._id} className="border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2 text-zinc-600">{new Date(sale.timestamp).toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {sale.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                </td>
                <td className="px-3 py-2 text-zinc-600">{sale.paymentMethod.replace("_", " ")}</td>
                <td className="px-3 py-2 font-medium text-zinc-900">${sale.totalAmount.toFixed(2)}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No sales in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
