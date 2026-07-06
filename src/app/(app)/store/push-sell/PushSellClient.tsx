"use client";

import { useEffect, useState } from "react";
import type { BuyerJSON, BuyerType, PaymentMethod, StoreJSON, StoreProductJSON, StoreBatchJSON } from "@/lib/types";
import type { BranchOption } from "@/lib/branchScope";
import { describeBreakdown, describeStock, pluralize } from "@/lib/unitHierarchy";

type Step = "catalog" | "action" | "destination" | "buyer" | "details" | "confirm";
type DestinationType = "store" | "branch";
type Flow = "push" | "sell" | null;

const BUYER_TYPES: BuyerType[] = ["distributor", "wholesaler", "retailer"];
const BUYER_TYPE_LABEL: Record<BuyerType, string> = {
  distributor: "Distributor",
  wholesaler: "Wholesaler",
  retailer: "Retailer",
};

export default function PushSellClient({ initialStoreId }: { initialStoreId: string }) {
  const [storeId] = useState(initialStoreId);
  const [products, setProducts] = useState<StoreProductJSON[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<StoreProductJSON | null>(null);
  const [referenceBatch, setReferenceBatch] = useState<StoreBatchJSON | null>(null);
  const [step, setStep] = useState<Step>("catalog");
  const [flow, setFlow] = useState<Flow>(null);

  const [destinationType, setDestinationType] = useState<DestinationType>("store");
  const [stores, setStores] = useState<StoreJSON[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [destinationId, setDestinationId] = useState("");

  const [buyerType, setBuyerType] = useState<BuyerType>("distributor");
  const [buyerResults, setBuyerResults] = useState<BuyerJSON[]>([]);
  const [buyerName, setBuyerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [form, setForm] = useState("");
  const [quantity, setQuantity] = useState("");
  const [referencePrice, setReferencePrice] = useState<{ priceForm: string; priceAmount: number } | null>(null);
  const [preview, setPreview] = useState<{
    totalValue: number;
    totalBaseUnitQuantity: number;
    batchesInvolved: number;
    referenceHierarchy: StoreBatchJSON["unitHierarchy"];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function loadProducts() {
    if (!storeId) return;
    fetch(`/api/store-products?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => setProducts(data.storeProducts || []));
  }

  useEffect(loadProducts, [storeId]);

  async function selectProduct(product: StoreProductJSON) {
    setSuccessMessage(null);
    setSelectedProduct(product);
    const res = await fetch(`/api/store-products/${product._id}/batches?storeId=${storeId}`);
    const data = await res.json();
    const batches: StoreBatchJSON[] = (data.batches || []).filter((b: StoreBatchJSON) => b.remainingBaseUnitQuantity > 0);
    if (batches.length === 0) {
      setError("This product has no stock left in any batch.");
      return;
    }
    setReferenceBatch(batches[0]);
    setForm(batches[0].receivedForm);
    setQuantity("");
    setError(null);
    setStep("action");
  }

  async function startPush() {
    setFlow("push");
    setDestinationType("store");
    setDestinationId("");
    const res = await fetch("/api/stores");
    const data = await res.json();
    setStores((data.stores || []).filter((s: StoreJSON) => s._id !== storeId));
    setStep("destination");
  }

  async function switchDestinationType(type: DestinationType) {
    setDestinationType(type);
    setDestinationId("");
    if (type === "store") {
      const res = await fetch("/api/stores");
      const data = await res.json();
      setStores((data.stores || []).filter((s: StoreJSON) => s._id !== storeId));
    } else {
      const res = await fetch("/api/branches");
      const data = await res.json();
      setBranches(data.branches || []);
    }
  }

  async function confirmDestination() {
    if (!destinationId || !referenceBatch) return;
    await loadReferencePrice(destinationType === "store" ? "sister_store" : "branch");
    setStep("details");
  }

  function startSell() {
    setFlow("sell");
    setBuyerName("");
    setBuyerResults([]);
    setStep("buyer");
  }

  async function searchBuyers(query: string) {
    setBuyerName(query);
    if (!query.trim()) {
      setBuyerResults([]);
      return;
    }
    const res = await fetch(`/api/buyers?type=${buyerType}&search=${encodeURIComponent(query.trim())}`);
    const data = await res.json();
    setBuyerResults(data.buyers || []);
  }

  async function confirmBuyer() {
    if (!buyerName.trim()) {
      setError("Enter a buyer name.");
      return;
    }
    await loadReferencePrice(buyerType);
    setError(null);
    setStep("details");
  }

  async function loadReferencePrice(channel: string) {
    if (!referenceBatch) return;
    const res = await fetch(`/api/store-batches/${referenceBatch._id}/dispense-settings`);
    const data = await res.json();
    const setting = (data.settings || []).find((s: { channel: string }) => s.channel === channel);
    setReferencePrice(setting ? { priceForm: setting.priceForm, priceAmount: setting.priceAmount } : null);
  }

  async function goToConfirm() {
    setError(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Enter a quantity of at least 1.");
      return;
    }
    if (!referencePrice) {
      setError("No price has been set for this channel yet.");
      return;
    }
    if (!selectedProduct) return;

    const channel = flow === "push" ? (destinationType === "store" ? "sister_store" : "branch") : buyerType;
    setPreviewLoading(true);
    const params = new URLSearchParams({ storeId, form, quantity: String(qty), channel });
    const res = await fetch(`/api/store-products/${selectedProduct._id}/draw-preview?${params}`);
    const data = await res.json();
    setPreviewLoading(false);
    if (!res.ok) {
      setError(data.error || "Could not price this quantity.");
      return;
    }
    setPreview({
      totalValue: data.totalValue,
      totalBaseUnitQuantity: data.totalBaseUnitQuantity,
      batchesInvolved: data.batchesInvolved,
      referenceHierarchy: data.referenceHierarchy,
    });
    setStep("confirm");
  }

  let breakdown = null;
  let breakdownError: string | null = null;
  if (step === "confirm" && preview) {
    try {
      const qty = Number(quantity);
      breakdown = describeBreakdown(preview.referenceHierarchy, form, qty, preview.totalValue);
    } catch (err) {
      breakdownError = err instanceof Error ? err.message : "Could not compute breakdown.";
    }
  }

  function resetToCatalog(message: string) {
    setSuccessMessage(message);
    setSelectedProduct(null);
    setReferenceBatch(null);
    setPreview(null);
    setFlow(null);
    setStep("catalog");
    loadProducts();
  }

  function spanNote(batchesInvolved: number) {
    return batchesInvolved > 1 ? ` (drawn from ${batchesInvolved} batches)` : "";
  }

  async function submitPush() {
    if (!selectedProduct) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/store-transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        storeProductId: selectedProduct._id,
        form,
        quantity: Number(quantity),
        destinationType,
        toStoreId: destinationType === "store" ? destinationId : undefined,
        toBranchId: destinationType === "branch" ? destinationId : undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Push failed.");
      return;
    }
    resetToCatalog(
      `Pushed ${quantity} ${pluralize(form, Number(quantity))} of ${selectedProduct.name}${spanNote(data.batchesInvolved)}.`
    );
  }

  async function submitSell() {
    if (!selectedProduct) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/store-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        storeProductId: selectedProduct._id,
        form,
        quantity: Number(quantity),
        buyerType,
        buyerName,
        paymentMethod,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Sale failed.");
      return;
    }
    resetToCatalog(
      `Sold ${quantity} ${pluralize(form, Number(quantity))} of ${selectedProduct.name} to ${buyerName}${spanNote(data.batchesInvolved)}.`
    );
  }

  if (step === "catalog") {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Push / Sell</h1>
        {successMessage && <p className="mb-3 text-sm text-teal-700">{successMessage}</p>}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product._id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-3 py-2">
                    <button
                      onClick={() => selectProduct(product)}
                      className="font-medium text-teal-700 hover:underline"
                    >
                      {product.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {describeStock(product.quantityInStock, product.displayUnitHierarchy, product.baseUnitName)}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                    No stock to push or sell yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (step === "action" && selectedProduct && referenceBatch) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">{selectedProduct.name}</h1>
        <p className="mb-4 text-sm text-zinc-600">
          {describeStock(selectedProduct.quantityInStock, referenceBatch.unitHierarchy, selectedProduct.baseUnitName)}{" "}
          remaining across all batches.
        </p>
        <div className="flex gap-2">
          <button
            onClick={startPush}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Push
          </button>
          <button
            onClick={startSell}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Sell
          </button>
          <button
            onClick={() => setStep("catalog")}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "destination" && selectedProduct) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Push {selectedProduct.name}</h1>
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => switchDestinationType("store")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${destinationType === "store" ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
          >
            Sister store
          </button>
          <button
            onClick={() => switchDestinationType("branch")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${destinationType === "branch" ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
          >
            Retail branch
          </button>
        </div>

        <select
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          className="mb-3 w-full max-w-sm rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Select a destination...</option>
          {destinationType === "store"
            ? stores.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.storeName}
                </option>
              ))
            : branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.branchName}
                </option>
              ))}
        </select>

        <div className="flex gap-2">
          <button
            onClick={confirmDestination}
            disabled={!destinationId}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Continue
          </button>
          <button
            onClick={() => setStep("action")}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "buyer" && selectedProduct) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">Sell {selectedProduct.name}</h1>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="mb-3 flex gap-2">
          {BUYER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setBuyerType(t);
                setBuyerResults([]);
                setBuyerName("");
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${buyerType === t ? "bg-teal-700 text-white" : "border border-zinc-300 text-zinc-700"}`}
            >
              {BUYER_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-sm font-medium text-zinc-700">Buyer name</label>
        <input
          value={buyerName}
          onChange={(e) => searchBuyers(e.target.value)}
          placeholder="Type a name — new or existing"
          className="mb-2 w-full max-w-sm rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />
        {buyerResults.length > 0 && (
          <ul className="mb-3 max-w-sm rounded border border-zinc-200 bg-white text-sm shadow-sm">
            {buyerResults.map((b) => (
              <li key={b._id}>
                <button
                  onClick={() => {
                    setBuyerName(b.name);
                    setBuyerResults([]);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-zinc-50"
                >
                  {b.name} — ₦{b.totalPurchaseAmount.toFixed(2)} lifetime
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <button
            onClick={confirmBuyer}
            disabled={!buyerName.trim()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Continue
          </button>
          <button
            onClick={() => setStep("action")}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "details" && selectedProduct && referenceBatch) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">
          {flow === "push" ? "Push" : "Sell"} {selectedProduct.name}
        </h1>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <label className="mb-1 block text-sm font-medium text-zinc-700">Quantity</label>
          <div className="mb-3 flex gap-2">
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <select
              value={form}
              onChange={(e) => setForm(e.target.value)}
              className="flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
            >
              {referenceBatch.unitHierarchy.map((level) => (
                <option key={level.unitName} value={level.unitName}>
                  {level.unitName}
                </option>
              ))}
            </select>
          </div>
          {referencePrice ? (
            <p className="mb-3 text-xs text-zinc-500">
              Set price: ₦{referencePrice.priceAmount.toFixed(2)} per {referencePrice.priceForm}
            </p>
          ) : (
            <p className="mb-3 text-xs text-red-600">No price set for this channel yet.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={goToConfirm}
              disabled={previewLoading}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {previewLoading ? "Pricing..." : "Review"}
            </button>
            <button
              onClick={() => setStep(flow === "push" ? "destination" : "buyer")}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "confirm" && selectedProduct) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-semibold text-zinc-900">
          Confirm {flow === "push" ? "push" : "sale"}
        </h1>
        <div className="max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm text-zinc-700">
            {flow === "push" ? "Pushing" : "Selling"} <strong>{quantity}</strong> {pluralize(form, Number(quantity))}{" "}
            of <strong>{selectedProduct.name}</strong>
            {flow === "sell" && (
              <>
                {" "}
                to <strong>{buyerName}</strong> ({BUYER_TYPE_LABEL[buyerType]})
              </>
            )}
            .
          </p>

          {breakdownError && <p className="mb-3 text-sm text-red-600">{breakdownError}</p>}

          {breakdown && (
            <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <p className="text-zinc-700">{breakdown.summarySentence}</p>
              {preview && preview.batchesInvolved > 1 && (
                <p className="mt-1 text-xs text-zinc-500">
                  Drawn from {preview.batchesInvolved} batches — each priced separately, total shown above.
                </p>
              )}
            </div>
          )}

          {flow === "sell" && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-zinc-700">Payment method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full max-w-xs rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile money / bank transfer</option>
              </select>
            </div>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => setStep("details")}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Edit
            </button>
            <button
              onClick={flow === "push" ? submitPush : submitSell}
              disabled={submitting || !!breakdownError}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? "Saving..." : flow === "push" ? "Confirm push" : "Complete sale"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
