"use client";

import { useEffect, useMemo, useState } from "react";
import type { PaymentMethod, ProductJSON } from "@/lib/types";

interface CartLine {
  product: ProductJSON;
  quantity: number;
}

const CATEGORY_LABEL: Record<ProductJSON["category"], string> = {
  supermarket: "Supermarket",
  medicine: "Medicine",
  "non-medicine": "Non-medicine",
};

export default function PosClient({ branchId }: { branchId: string | null }) {
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function productParams() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    return params.toString();
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/products?${productParams()}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
      }
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, branchId]);

  function addToCart(product: ProductJSON) {
    setCart((prev) => {
      const existing = prev.find((line) => line.product._id === product._id);
      if (existing) {
        return prev.map((line) =>
          line.product._id === product._id
            ? { ...line, quantity: Math.min(line.quantity + 1, product.quantityInStock) }
            : line
        );
      }
      if (product.quantityInStock < 1) return prev;
      return [...prev, { product, quantity: 1 }];
    });
  }

  function updateLine(productId: string, changes: Partial<CartLine>) {
    setCart((prev) =>
      prev.map((line) => (line.product._id === productId ? { ...line, ...changes } : line))
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((line) => line.product._id !== productId));
  }

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.retailPrice * line.quantity, 0),
    [cart]
  );

  async function completeSale() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setMessage(null);

    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId,
        paymentMethod,
        items: cart.map((line) => ({
          productId: line.product._id,
          quantity: line.quantity,
          priceTier: "retail",
        })),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setMessage({ type: "error", text: data.error || "Sale failed" });
      return;
    }

    setMessage({ type: "success", text: `Sale completed: ₦${total.toFixed(2)}` });
    setCart([]);
    setPaymentMethod("cash");
    const refreshed = await fetch(`/api/products?${productParams()}`);
    if (refreshed.ok) setProducts((await refreshed.json()).products);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="mb-3 text-lg font-semibold text-zinc-900">Product catalog</h1>
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {products.map((product) => (
            <button
              key={product._id}
              onClick={() => addToCart(product)}
              disabled={product.quantityInStock < 1}
              className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm hover:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="font-medium text-zinc-900">{product.name}</span>
              <span className="text-xs text-zinc-500">
                {CATEGORY_LABEL[product.category]} · Stock: {product.quantityInStock}
              </span>
              <span className="mt-1 text-sm font-semibold text-teal-700">
                ₦{product.retailPrice.toFixed(2)}
              </span>
            </button>
          ))}
          {products.length === 0 && (
            <p className="col-span-2 text-sm text-zinc-500">No products found.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900">Current sale</h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          {cart.length === 0 && <p className="text-sm text-zinc-500">Cart is empty.</p>}
          <div className="flex flex-col gap-3">
            {cart.map((line) => (
              <div key={line.product._id} className="border-b border-zinc-100 pb-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900">{line.product.name}</span>
                  <button
                    onClick={() => removeLine(line.product._id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={line.product.quantityInStock}
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(line.product._id, {
                        quantity: Math.max(
                          1,
                          Math.min(Number(e.target.value) || 1, line.product.quantityInStock)
                        ),
                      })
                    }
                    className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-zinc-600">₦{line.product.retailPrice.toFixed(2)} each</span>
                </div>
                <div className="mt-1 text-right text-sm text-zinc-600">
                  ₦{(line.product.retailPrice * line.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="text-lg font-bold text-zinc-900">₦{total.toFixed(2)}</span>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-zinc-700">Payment method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded border border-zinc-300 px-2 py-2 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="mobile_money">Mobile money / bank transfer</option>
                </select>
              </div>

              <button
                onClick={completeSale}
                disabled={submitting}
                className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {submitting ? "Processing..." : "Complete sale"}
              </button>
            </>
          )}

          {message && (
            <p
              className={`mt-3 text-sm ${message.type === "success" ? "text-teal-700" : "text-red-600"}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
