"use client";

import { useEffect, useMemo, useState } from "react";
import { formatProductLabel, type PaymentMethod, type ProductCategory, type ProductJSON } from "@/lib/types";
import { getExpiryStatus, EXPIRY_BADGE_CLASS } from "@/lib/expiry";
import { computeBaseUnitsPerLevel, pluralize } from "@/lib/unitHierarchy";

type CartLine =
  | { kind: "catalog"; key: string; product: ProductJSON; form: string; quantity: number }
  | {
      kind: "custom";
      key: string;
      itemName: string;
      brand: string;
      size: string;
      category: ProductCategory;
      unitPrice: number;
      quantity: number;
    };

function baseUnitName(product: ProductJSON): string {
  const h = product.unitHierarchy;
  return h && h.length > 0 ? h[h.length - 1].unitName : "unit";
}

function piecesPerForm(product: ProductJSON, form: string): number {
  const h = product.unitHierarchy;
  if (!h || h.length === 0) return 1;
  return computeBaseUnitsPerLevel(h)[form] ?? 1;
}

interface PaymentLine {
  method: PaymentMethod;
  amount: string;
}

const CATEGORY_LABEL: Record<ProductJSON["category"], string> = {
  supermarket: "Supermarket",
  medicine: "Medicine",
  "non-medicine": "Non-medicine",
};

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money: "Mobile money / bank transfer",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const EPS = 0.005;

export default function PosClient({ branchId }: { branchId: string | null }) {
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [changeFee, setChangeFee] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [customMode, setCustomMode] = useState(false);
  const [customForm, setCustomForm] = useState({
    itemName: "",
    brand: "",
    size: "",
    category: "supermarket" as ProductCategory,
    price: "",
    quantity: "1",
  });
  const [customMatches, setCustomMatches] = useState<ProductJSON[]>([]);
  const [customError, setCustomError] = useState<string | null>(null);

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
      const existing = prev.find((line) => line.kind === "catalog" && line.product._id === product._id);
      if (existing && existing.kind === "catalog") {
        const maxQty = Math.floor(product.quantityInStock / piecesPerForm(product, existing.form));
        return prev.map((line) =>
          line.kind === "catalog" && line.product._id === product._id
            ? { ...line, quantity: Math.min(line.quantity + 1, maxQty) }
            : line
        );
      }
      if (product.quantityInStock < 1) return prev;
      return [...prev, { kind: "catalog", key: product._id, product, form: baseUnitName(product), quantity: 1 }];
    });
  }

  function updateLine(key: string, changes: Partial<CartLine>) {
    setCart((prev) => prev.map((line) => (line.key === key ? ({ ...line, ...changes } as CartLine) : line)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((line) => line.key !== key));
  }

  const total = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          (line.kind === "catalog"
            ? line.product.retailPrice * piecesPerForm(line.product, line.form) * line.quantity
            : line.unitPrice * line.quantity),
        0
      ),
    [cart]
  );

  // Close matches for whatever the staff is typing as a custom item's name, so they can bail
  // into the normal add-to-cart flow if it turns out the item actually is in the catalog.
  useEffect(() => {
    if (!customMode || !customForm.itemName.trim()) {
      const timeout = setTimeout(() => setCustomMatches([]), 0);
      return () => clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      const params = new URLSearchParams({ search: customForm.itemName.trim() });
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
      if (res.ok) setCustomMatches((await res.json()).products.slice(0, 5));
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [customMode, customForm.itemName, branchId]);

  function addCustomToCart() {
    setCustomError(null);
    const itemName = customForm.itemName.trim();
    const brand = customForm.brand.trim();
    const size = customForm.size.trim();
    const price = Number(customForm.price);
    const quantity = Math.max(1, Math.floor(Number(customForm.quantity) || 1));

    if (!itemName) return setCustomError("Item name is required.");
    if (!brand) {
      return setCustomError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
    }
    if (!size) {
      return setCustomError('Size is required — use "Standard" if the item has no size/strength variation.');
    }
    if (!Number.isFinite(price) || price <= 0) return setCustomError("Price must be greater than 0.");

    setCart((prev) => [
      ...prev,
      {
        kind: "custom",
        key: `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemName,
        brand,
        size,
        category: customForm.category,
        unitPrice: price,
        quantity,
      },
    ]);
    setCustomForm({ itemName: "", brand: "", size: "", category: "supermarket", price: "", quantity: "1" });
    setCustomMatches([]);
    setCustomMode(false);
  }

  // Fast path: keep the single payment line synced to the cart total until the staff
  // actually edits it, so completing a normal single-method sale stays a one-click action.
  useEffect(() => {
    if (paymentsTouched || payments.length !== 1) return;
    const timeout = setTimeout(() => {
      setPayments([{ method: payments[0].method, amount: total > 0 ? total.toFixed(2) : "" }]);
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  function addPaymentLine() {
    setPaymentsTouched(true);
    setPayments((prev) => [...prev, { method: "cash", amount: "" }]);
  }

  function removePaymentLine(index: number) {
    setPaymentsTouched(true);
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePaymentLine(index: number, changes: Partial<PaymentLine>) {
    setPaymentsTouched(true);
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  }

  const amountTendered = useMemo(
    () => round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)),
    [payments]
  );
  const changeDue = round2(Math.max(0, amountTendered - total));
  const changeFeeValue = Number(changeFee) || 0;
  const cashToHandBack = round2(Math.max(0, changeDue - changeFeeValue));

  const canCompleteSale =
    cart.length > 0 &&
    payments.every((p) => Number(p.amount) > 0) &&
    amountTendered >= total - EPS &&
    changeFeeValue <= changeDue + EPS;

  async function completeSale() {
    if (!canCompleteSale) return;
    setSubmitting(true);
    setMessage(null);

    const customLabels = cart.filter((l) => l.kind === "custom").map((l) => l.itemName);

    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId,
        payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
        changeFee: changeFeeValue,
        items: cart.map((line) =>
          line.kind === "catalog"
            ? {
                productId: line.product._id,
                quantity: line.quantity,
                form: line.product.unitHierarchy?.length ? line.form : undefined,
                priceTier: "retail",
              }
            : {
                custom: true,
                itemName: line.itemName,
                brand: line.brand,
                size: line.size,
                category: line.category,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              }
        ),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setMessage({ type: "error", text: data.error || "Sale failed" });
      return;
    }

    setMessage({
      type: "success",
      text:
        `Sale completed: ₦${total.toFixed(2)}` +
        (customLabels.length > 0
          ? ` — flagged ${customLabels.join(", ")} for admin to add to the catalog.`
          : ""),
    });
    setCart([]);
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
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
          className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />

        <button
          onClick={() => setCustomMode((v) => !v)}
          className="mb-4 text-sm font-medium text-teal-700 hover:underline"
        >
          {customMode ? "Cancel custom sell" : "Can't find it? Sell as custom item"}
        </button>

        {customMode && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-xs text-amber-800">
              For items on the shelf but not in the system. This won&apos;t touch stock — it flags the item for
              admin to add to the catalog.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Item name"
                value={customForm.itemName}
                onChange={(e) => setCustomForm({ ...customForm, itemName: e.target.value })}
                className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm sm:col-span-1"
              />
              <input
                placeholder="Brand / manufacturer"
                value={customForm.brand}
                onChange={(e) => setCustomForm({ ...customForm, brand: e.target.value })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <input
                placeholder='Size (e.g. 5mg, "Standard")'
                value={customForm.size}
                onChange={(e) => setCustomForm({ ...customForm, size: e.target.value })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <select
                value={customForm.category}
                onChange={(e) => setCustomForm({ ...customForm, category: e.target.value as ProductCategory })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="supermarket">Supermarket</option>
                <option value="medicine">Medicine</option>
                <option value="non-medicine">Non-medicine</option>
              </select>
              <input
                type="number"
                min={0}
                placeholder="Price sold for"
                value={customForm.price}
                onChange={(e) => setCustomForm({ ...customForm, price: e.target.value })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                min={1}
                placeholder="Quantity"
                value={customForm.quantity}
                onChange={(e) => setCustomForm({ ...customForm, quantity: e.target.value })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </div>

            {customMatches.length > 0 && (
              <div className="mt-2 rounded border border-zinc-200 bg-white p-2">
                <p className="mb-1 text-xs font-medium text-zinc-600">
                  Possible matches already in the catalog — check before selling as custom:
                </p>
                <div className="flex flex-col gap-1">
                  {customMatches.map((product) => (
                    <button
                      key={product._id}
                      onClick={() => {
                        addToCart(product);
                        setCustomMode(false);
                        setCustomForm({ itemName: "", brand: "", size: "", category: "supermarket", price: "", quantity: "1" });
                        setCustomMatches([]);
                      }}
                      className="rounded px-2 py-1 text-left text-sm text-teal-700 hover:bg-teal-50"
                    >
                      {formatProductLabel(product)} — Stock: {product.quantityInStock}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customError && <p className="mt-2 text-sm text-red-600">{customError}</p>}

            <button
              onClick={addCustomToCart}
              className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
            >
              Add custom item to cart
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {products.map((product) => {
            const expiryStatus = getExpiryStatus(product.expiryDate);
            return (
              <button
                key={product._id}
                onClick={() => addToCart(product)}
                disabled={product.quantityInStock < 1}
                className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm hover:border-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900">{formatProductLabel(product)}</span>
                  {expiryStatus.label && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${EXPIRY_BADGE_CLASS[expiryStatus.level]}`}
                    >
                      {expiryStatus.label}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-500">
                  {CATEGORY_LABEL[product.category]} · Stock: {product.quantityInStock}
                </span>
                <span className="mt-1 text-sm font-semibold text-teal-700">
                  ₦{product.retailPrice.toFixed(2)}
                </span>
              </button>
            );
          })}
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
            {cart.map((line) => {
              if (line.kind === "custom") {
                return (
                  <div key={line.key} className="border-b border-zinc-100 pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-900">
                        {formatProductLabel(line)}{" "}
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Not in catalog
                        </span>
                      </span>
                      <button onClick={() => removeLine(line.key)} className="text-xs text-red-600 hover:underline">
                        Remove
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm"
                      />
                      <span className="text-sm text-zinc-600">₦{line.unitPrice.toFixed(2)} each</span>
                    </div>
                    <div className="mt-1 text-right text-sm text-zinc-600">
                      ₦{(line.unitPrice * line.quantity).toFixed(2)}
                    </div>
                  </div>
                );
              }

              const hierarchy = line.product.unitHierarchy;
              const perForm = piecesPerForm(line.product, line.form);
              const maxQty = Math.floor(line.product.quantityInStock / perForm);
              const priceForForm = line.product.retailPrice * perForm;
              return (
                <div key={line.key} className="border-b border-zinc-100 pb-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-900">{formatProductLabel(line.product)}</span>
                    <button
                      onClick={() => removeLine(line.key)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={maxQty}
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.key, {
                          quantity: Math.max(1, Math.min(Number(e.target.value) || 1, maxQty)),
                        })
                      }
                      className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm"
                    />
                    {hierarchy && hierarchy.length > 0 ? (
                      <select
                        value={line.form}
                        onChange={(e) => {
                          const newForm = e.target.value;
                          const newMax = Math.floor(line.product.quantityInStock / piecesPerForm(line.product, newForm));
                          updateLine(line.key, { form: newForm, quantity: Math.min(1, newMax) || 1 });
                        }}
                        className="rounded border border-zinc-300 px-2 py-1 text-sm"
                      >
                        {hierarchy.map((level) => (
                          <option key={level.unitName} value={level.unitName}>
                            {pluralize(level.unitName, 2)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-zinc-600">₦{line.product.retailPrice.toFixed(2)} each</span>
                    )}
                  </div>
                  {hierarchy && hierarchy.length > 0 && (
                    <div className="mt-1 text-xs text-zinc-500">₦{priceForForm.toFixed(2)} per {line.form}</div>
                  )}
                  <div className="mt-1 text-right text-sm text-zinc-600">
                    ₦{(priceForForm * line.quantity).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>

          {cart.length > 0 && (
            <>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3">
                <span className="font-semibold text-zinc-900">Total</span>
                <span className="text-lg font-bold text-zinc-900">₦{total.toFixed(2)}</span>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-zinc-700">Payment</label>
                <div className="flex flex-col gap-2">
                  {payments.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={line.method}
                        onChange={(e) => updatePaymentLine(i, { method: e.target.value as PaymentMethod })}
                        className="rounded border border-zinc-300 px-2 py-2 text-sm"
                      >
                        {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        placeholder="Amount"
                        value={line.amount}
                        onChange={(e) => updatePaymentLine(i, { amount: e.target.value })}
                        className="w-24 flex-1 rounded border border-zinc-300 px-2 py-2 text-sm"
                      />
                      {payments.length > 1 && (
                        <button
                          onClick={() => removePaymentLine(i)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={addPaymentLine}
                  className="mt-2 text-xs font-medium text-teal-700 hover:underline"
                >
                  + Split payment
                </button>
                {(payments.length > 1 || Math.abs(amountTendered - total) > EPS) && (
                  <p className="mt-2 text-xs text-zinc-500">Amount tendered: ₦{amountTendered.toFixed(2)}</p>
                )}
              </div>

              {changeDue > 0.004 && (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-700">Change due</span>
                    <span className="font-medium text-zinc-900">₦{changeDue.toFixed(2)}</span>
                  </div>
                  <div className="mt-2">
                    <label className="mb-1 block text-xs font-medium text-zinc-700">
                      Change fee (optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={changeDue}
                      value={changeFee}
                      onChange={(e) => setChangeFee(e.target.value)}
                      className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
                    <span className="text-zinc-700">Cash to hand back</span>
                    <span className="font-semibold text-zinc-900">₦{cashToHandBack.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button
                onClick={completeSale}
                disabled={submitting || !canCompleteSale}
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
