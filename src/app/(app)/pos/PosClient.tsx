"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatProductLabel, type PaymentMethod, type ProductCategory, type ProductJSON } from "@/lib/types";
import { getExpiryStatus, EXPIRY_BADGE_CLASS } from "@/lib/expiry";
import { computeBaseUnitsPerLevel, pluralize } from "@/lib/unitHierarchy";
import { parseNumeric } from "@/lib/numberInput";
import ReceiptTemplate, { type ReceiptSale } from "./ReceiptTemplate";
import { usePosOfflineSync } from "./usePosOfflineSync";
import { db } from "@/lib/db";

type CartLine =
  | { kind: "catalog"; key: string; product: ProductJSON; form: string; quantity: number; instruction?: string }
  | {
      kind: "custom";
      key: string;
      itemName: string;
      brand: string;
      size: string;
      category: ProductCategory;
      unitPrice: number;
      unitCost: number;
      quantity: number;
      instruction?: string;
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

interface HeldSale {
  id: string;
  heldAt: number;
  cart: CartLine[];
  payments: PaymentLine[];
  paymentsTouched: boolean;
  changeFee: string;
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

function cartStorageKey(branchId: string | null): string {
  return `pos-cart-${branchId ?? "default"}`;
}

function heldSalesStorageKey(branchId: string | null): string {
  return `pos-held-${branchId ?? "default"}`;
}

function lineAmount(line: CartLine): number {
  return line.kind === "catalog"
    ? line.product.retailPrice * piecesPerForm(line.product, line.form) * line.quantity
    : line.unitPrice * line.quantity;
}

function lineCost(line: CartLine): number {
  return line.kind === "catalog"
    ? (line.product.costPrice || 0) * piecesPerForm(line.product, line.form) * line.quantity
    : (line.unitCost || 0) * line.quantity;
}

export default function PosClient({ 
  branchId, 
  pharmacyId, 
  pharmacyName, 
  branchName, 
  branchAddress, 
  staffName 
}: { 
  branchId: string | null; 
  pharmacyId: string; 
  pharmacyName?: string; 
  branchName?: string; 
  branchAddress?: string; 
  staffName?: string; 
}) {
  const { isOnline, syncStatus, lastSyncedAt, pendingSales, syncPendingSales } = usePosOfflineSync(branchId);
  const [showOfflineTray, setShowOfflineTray] = useState(false);
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [changeFee, setChangeFee] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [iframeHeight, setIframeHeight] = useState(42);
  const [loadingPrescription, setLoadingPrescription] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<{ id: string | null; name: string | null; encounterId: string | null }>({ id: null, name: null, encounterId: null });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [enablePrintListener, setEnablePrintListener] = useState(false);
  const [lastSale, setLastSale] = useState<ReceiptSale | null>(null);
  
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // No native patient search state needed, EMR iframe handles it.

  // Listen for POPULATE_CART from the EMR Dispensary iframe
  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      if (event.data?.type === "POPULATE_CART" && event.data.medicines) {
        const medicines = event.data.medicines;
        const patientName = event.data.patientName || "Patient";
        const patientId = event.data.patientId || null;
        const encounterId = event.data.encounterId || null;
        
        setCurrentCustomer({ id: patientId, name: patientName, encounterId });
        setLoadingPrescription(true);
        const nextCart: CartLine[] = [];
        
        for (const med of medicines) {
          if (!med || !med.name) continue;
          
          const searchParams = new URLSearchParams({ search: med.name });
          if (branchId) searchParams.set("branchId", branchId);
          
          try {
            let foundProduct = null;
            
            if (med.productId) {
              const prodRes = await fetch(`/api/products/${med.productId}`);
              if (prodRes.ok) {
                const prodData = await prodRes.json();
                foundProduct = prodData.product || null;
              }
            }
            
            if (!foundProduct) {
              const searchParams = new URLSearchParams({ search: med.name });
              if (branchId) searchParams.set("branchId", branchId);
              const prodRes = await fetch(`/api/products?${searchParams}`);
              if (prodRes.ok) {
                const prodData = await prodRes.json();
                foundProduct = prodData.products?.[0];
              }
            }
            
            if (foundProduct) {
              const existingIndex = nextCart.findIndex((line) => line.kind === "catalog" && line.product._id === foundProduct._id);
              if (existingIndex >= 0) {
                const existing = nextCart[existingIndex];
                if (existing.kind === "catalog") {
                  existing.quantity += (Number(med.qty) || 1);
                  if (med.dose) existing.instruction = med.dose;
                }
              } else {
                nextCart.push({ kind: "catalog", key: foundProduct._id, product: foundProduct, form: baseUnitName(foundProduct), quantity: Number(med.qty) || 1, instruction: med.dose });
              }
            } else {
              const parseMatch = med.name.match(/^(.*?)\s*\((.*?)\)\s*(.*?)$/);
              const itemName = parseMatch ? parseMatch[1] : med.name;
              const brand = parseMatch ? parseMatch[2] : "Prescribed";
              const size = parseMatch ? parseMatch[3] : "Standard";
              
              nextCart.push({
                kind: "custom",
                key: `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                itemName,
                brand,
                size,
                category: "medicine",
                unitPrice: Number(med.price) || 0,
                unitCost: 0,
                quantity: Number(med.qty) || 1,
                instruction: med.dose,
              });
            }
          } catch (e) {
            console.error("Failed to fetch product for", med.name, e);
            // On network error, fallback to custom item
            nextCart.push({
              kind: "custom",
              key: `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              itemName: med.name,
              brand: "Prescribed",
              size: "Standard",
              category: "medicine",
              unitPrice: 0,
              unitCost: 0,
              quantity: Number(med.qty) || 1,
            });
          }
        }
        
        setCart(nextCart);
        setMessage({ type: "success", text: `Loaded EMR prescription for ${patientName} (${nextCart.length} items)` });
        setLoadingPrescription(false);
      } else if (event.data?.type === "RESIZE_IFRAME" && event.data.height) {
        setIframeHeight(event.data.height);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [branchId]);

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

  const cartSectionRef = useRef<HTMLDivElement>(null);
  const productListRef = useRef<HTMLDivElement>(null);

  // Typing a new search shouldn't leave the results list scrolled to wherever it happened to be
  // from browsing before — jump back to the top so the best matches are actually visible.
  useEffect(() => {
    productListRef.current?.scrollTo(0, 0);
  }, [search]);

  // So staff get visual confirmation an item landed in the cart, instead of it silently
  // updating somewhere off-screen while the catalog list stays put.
  function scrollToCart() {
    cartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Survive a refresh instead of silently wiping out whatever was already added — scoped per
  // branch so switching branches (admin) never shows a cart built from a different branch's
  // stock. isHydratingRef suppresses the very next persist-effect run so it doesn't immediately
  // overwrite the just-loaded cart with the stale pre-hydration value.
  const isHydratingRef = useRef(false);

  useEffect(() => {
    isHydratingRef.current = true;
    const saved = localStorage.getItem(cartStorageKey(branchId));
    const timeout = setTimeout(() => {
      try {
        setCart(saved ? JSON.parse(saved) : []);
      } catch {
        setCart([]);
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [branchId]);

  useEffect(() => {
    if (isHydratingRef.current) {
      isHydratingRef.current = false;
      return;
    }
    localStorage.setItem(cartStorageKey(branchId), JSON.stringify(cart));
  }, [cart, branchId]);

  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const isHeldHydratingRef = useRef(false);

  useEffect(() => {
    isHeldHydratingRef.current = true;
    const saved = localStorage.getItem(heldSalesStorageKey(branchId));
    const timeout = setTimeout(() => {
      try {
        setHeldSales(saved ? JSON.parse(saved) : []);
      } catch {
        setHeldSales([]);
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [branchId]);

  useEffect(() => {
    if (isHeldHydratingRef.current) {
      isHeldHydratingRef.current = false;
      return;
    }
    localStorage.setItem(heldSalesStorageKey(branchId), JSON.stringify(heldSales));
  }, [heldSales, branchId]);

  const handleLocalPrint = () => {
    setShowPrintPrompt(false);
    setTimeout(() => {
      window.print();
      setLastSale(null);
    }, 100);
  };

  const handleRemotePrint = async () => {
    if (!lastSale) return;
    setSubmitting(true);
    try {
      await fetch(`/api/sales/${lastSale._id}/request-print?branchId=${branchId}`, { method: "PATCH" });
    } catch (e) {}
    setSubmitting(false);
    setShowPrintPrompt(false);
    setLastSale(null);
  };

  const handleNoPrint = () => {
    setShowPrintPrompt(false);
    setLastSale(null);
  };

  // Background print listener for remote mobile sales
  const isPrintingRemoteRef = useRef(false);
  useEffect(() => {
    if (!enablePrintListener) return;
    const interval = setInterval(async () => {
      if (isPrintingRemoteRef.current) return;
      try {
        const params = new URLSearchParams();
        if (branchId) params.set("branchId", branchId);
        
        const res = await fetch(`/api/sales/print-queue?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        const pendingSales: ReceiptSale[] = data.sales;

        if (pendingSales.length > 0) {
          isPrintingRemoteRef.current = true;
          // Process just the first pending sale to avoid overlapping prints
          const job = pendingSales[0];
          setLastSale(job);
          
          // Wait for DOM to render the receipt, then trigger print dialog.
          // window.print() blocks until the dialog is closed.
          setTimeout(async () => {
            window.print();
            setLastSale(null);
            
            try {
              await fetch(`/api/sales/${job._id}/mark-printed?${params}`, {
                method: "POST",
              });
            } finally {
              isPrintingRemoteRef.current = false;
            }
          }, 500);
        }
      } catch (err) {
        console.error("Print listener error:", err);
        isPrintingRemoteRef.current = false;
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [enablePrintListener, branchId]);

  function holdSale() {
    if (cart.length === 0) return;
    setHeldSales((prev) => [
      ...prev,
      {
        id: `held-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        heldAt: Date.now(),
        cart,
        payments,
        paymentsTouched,
        changeFee,
      },
    ]);
    setCart([]);
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
    setMessage(null);
  }

  function resumeHeldSale(id: string) {
    if (cart.length > 0) {
      alert("Hold or clear the current sale before resuming another one.");
      return;
    }
    const held = heldSales.find((h) => h.id === id);
    if (!held) return;
    setCart(held.cart);
    setPayments(held.payments);
    setPaymentsTouched(held.paymentsTouched);
    setChangeFee(held.changeFee);
    setHeldSales((prev) => prev.filter((h) => h.id !== id));
    setMessage(null);
    setShowHeld(false);
    scrollToCart();
  }

  function discardHeldSale(id: string) {
    if (!confirm("Discard this held sale? This can't be undone.")) return;
    setHeldSales((prev) => prev.filter((h) => h.id !== id));
  }

  function productParams() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    return params.toString();
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      if (!isOnline) {
        const query = search.toLowerCase();
        const allProducts = await db.products.toArray();
        const filtered = allProducts.filter(p => 
          (p.itemName && p.itemName.toLowerCase().includes(query)) ||
          (p.brand && p.brand.toLowerCase().includes(query)) ||
          (p.barcode && p.barcode.includes(query))
        );
        setProducts(filtered.slice(0, 50) as unknown as ProductJSON[]);
      } else {
        try {
          const res = await fetch(`/api/products?${productParams()}`, { signal: controller.signal });
          if (res.ok) {
            const data = await res.json();
            setProducts(data.products);
          }
        } catch (e: any) {
          if (e.name !== "AbortError") console.error("Search fetch error", e);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [search, branchId, isOnline]);

  // Global Barcode Scanner Listener
  useEffect(() => {
    let barcodeBuffer = "";
    let lastKeyTime = Date.now();

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ignore if user is intentionally typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      const currentTime = Date.now();
      // Barcode scanners type very fast (usually <20ms per character). 
      // If there's a pause > 50ms, it's probably a human typing, so we reset.
      if (currentTime - lastKeyTime > 50) {
        barcodeBuffer = "";
      }
      lastKeyTime = currentTime;

      if (e.key === "Enter" && barcodeBuffer.length > 3) {
        e.preventDefault();
        const scannedCode = barcodeBuffer;
        barcodeBuffer = "";
        
        if (!navigator.onLine) {
          const allProducts = await db.products.toArray();
          const matchedProduct = allProducts.find(p => p.barcode === scannedCode);
          if (matchedProduct) {
            addToCart(matchedProduct as unknown as ProductJSON);
            scrollToCart();
          }
        } else {
          const params = new URLSearchParams({ search: scannedCode });
          if (branchId) params.set("branchId", branchId);
          
          const res = await fetch(`/api/products?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            const matchedProduct = data.products.find((p: ProductJSON) => p.barcode === scannedCode);
            if (matchedProduct) {
              addToCart(matchedProduct);
              scrollToCart();
            }
          }
        }
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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

  function clearCart() {
    if (cart.length === 0) return;
    if (!confirm("Clear all items from the current sale?")) return;
    setCart([]);
    setCurrentCustomer({ id: null, name: null, encounterId: null });
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
    setMessage(null);
  }

  const total = useMemo(() => cart.reduce((sum, line) => sum + lineAmount(line), 0), [cart]);

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
      try {
        const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
        if (res.ok) setCustomMatches((await res.json()).products.slice(0, 5));
      } catch (e: any) {
        if (e.name !== "AbortError") console.error("Custom search error", e);
      }
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
    const price = parseNumeric(customForm.price);
    const quantity = Math.max(1, Math.floor(parseNumeric(customForm.quantity) || 1));

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
        unitCost: 0,
        quantity,
      },
    ]);
    setCustomForm({ itemName: "", brand: "", size: "", category: "supermarket", price: "", quantity: "1" });
    setCustomMatches([]);
    setCustomMode(false);
    scrollToCart();
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
    () => round2(payments.reduce((sum, p) => sum + (parseNumeric(p.amount) || 0), 0)),
    [payments]
  );
  const changeDue = round2(Math.max(0, amountTendered - total));
  const changeFeeValue = parseNumeric(changeFee) || 0;
  const cashToHandBack = round2(Math.max(0, changeDue - changeFeeValue));

  const canCompleteSale =
    cart.length > 0 &&
    payments.every((p) => parseNumeric(p.amount) > 0) &&
    amountTendered >= total - EPS &&
    changeFeeValue <= changeDue + EPS;

  function openConfirmModal() {
    if (!canCompleteSale) return;
    setShowConfirmModal(true);
  }

  async function executeCompleteSale() {
    if (!canCompleteSale) return;
    setShowConfirmModal(false);
    setSubmitting(true);
    setMessage(null);

    const customLabels = cart.filter((l) => l.kind === "custom").map((l) => l.itemName);

    const payloadItems = cart.map((line) =>
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
            unitCost: line.unitCost,
          }
    );

    const payload = {
      branchId,
      customerId: currentCustomer.id,
      customerName: currentCustomer.name,
      payments: payments.map((p) => ({ method: p.method, amount: parseNumeric(p.amount) })),
      changeFee: changeFeeValue,
      items: payloadItems,
    };

    if (!isOnline) {
      const offlineReceiptNumber = `OFF-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;
      await db.pendingSales.add({
        offlineReceiptNumber,
        customerName: currentCustomer.name || undefined,
        userName: staffName,
        items: payloadItems,
        totalAmount: total,
        payments: payload.payments,
        amountTendered: payload.payments.reduce((sum, p) => sum + p.amount, 0),
        changeGiven: changeFeeValue,
        timestamp: new Date().toISOString(),
        pharmacyId,
        synced: 0
      });

      setSubmitting(false);
      setMessage({ type: "success", text: `Offline sale saved. Will sync when online.` });
      
      const fullSaleData: ReceiptSale = {
        _id: `offline-${Date.now()}`,
        receiptNumber: offlineReceiptNumber,
        customerName: currentCustomer.name || undefined,
        userName: staffName || "Staff",
        items: payloadItems as any,
        totalAmount: total,
        payments: payload.payments as any,
        amountTendered: payload.payments.reduce((sum, p) => sum + p.amount, 0),
        changeGiven: changeFeeValue,
        timestamp: new Date().toISOString(),
      };
      setLastSale(fullSaleData);
      setShowPrintPrompt(true);

      setCart([]);
      setCurrentCustomer({ id: null, name: null, encounterId: null });
      setPayments([{ method: "cash", amount: "" }]);
      setPaymentsTouched(false);
      setChangeFee("0");
      return;
    }

    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
    
    if (currentCustomer.encounterId && iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({
        type: "MARK_DISPENSED",
        encounterId: currentCustomer.encounterId,
      }, "*");
    }

    setCart([]);
    setCurrentCustomer({ id: null, name: null, encounterId: null });
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
    const refreshed = await fetch(`/api/products?${productParams()}`);
    if (refreshed.ok) setProducts((await refreshed.json()).products);
    
    if (data.sale) {
      // Re-map the API response to fit the ReceiptSale shape needed by the template
      const fullSaleData: ReceiptSale = {
        _id: data.sale._id,
        receiptNumber: data.sale.receiptNumber,
        customerName: data.sale.customerName,
        userName: staffName || "Staff", // Immediate print assumes current user
        items: data.sale.items,
        totalAmount: data.sale.totalAmount,
        payments: data.sale.payments,
        amountTendered: data.sale.amountTendered,
        changeGiven: data.sale.changeGiven,
        timestamp: data.sale.timestamp,
      };
      setLastSale(fullSaleData);
      setShowPrintPrompt(true);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {lastSale && (
        <ReceiptTemplate
          sale={lastSale}
          pharmacyName={pharmacyName || "Pharmacy"}
          branchName={branchName}
          branchAddress={branchAddress}
        />
      )}
      {/* Offline Sync Tray */}
      {showOfflineTray && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-zinc-900/20 backdrop-blur-sm"
            onClick={() => setShowOfflineTray(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l border-zinc-200 bg-zinc-50 shadow-2xl overflow-y-auto transform transition-transform duration-300">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 p-4 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-zinc-900">Offline Queue</h2>
              <button
                onClick={() => setShowOfflineTray(false)}
                className="rounded p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              {pendingSales.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-8">No pending sales.</p>
              ) : (
                pendingSales.map((sale) => (
                  <div key={sale.id} className={`rounded-xl border p-3 ${sale.synced === 2 ? 'border-red-200 bg-red-50' : 'border-zinc-200 bg-white shadow-sm'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-zinc-900 text-sm">{sale.offlineReceiptNumber}</p>
                        <p className="text-xs text-zinc-500">{new Date(sale.timestamp).toLocaleTimeString()}</p>
                      </div>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${sale.synced === 2 ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                        {sale.synced === 2 ? 'Failed' : 'Queued'}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-700">
                      <p>{sale.items.length} items • ₦{sale.totalAmount.toLocaleString()}</p>
                    </div>
                    {sale.synced === 2 && (
                      <div className="mt-3 pt-3 border-t border-red-200/60">
                        <p className="text-[11px] leading-tight text-red-700 font-medium mb-3">Sync failed: Server rejected the sale. Check stock or catalog changes.</p>
                        <div className="flex gap-2">
                           <button onClick={async () => {
                             await db.pendingSales.update(sale.id!, { synced: 0 });
                             if (isOnline) syncPendingSales();
                           }} className="text-xs bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1.5 rounded-lg font-semibold transition-colors">Retry</button>
                           <button onClick={async () => {
                             if (confirm("Are you sure you want to discard this offline sale? This cannot be undone.")) {
                               await db.pendingSales.delete(sale.id!);
                             }
                           }} className="text-xs bg-white border border-red-200 hover:bg-red-50 text-red-700 px-3 py-1.5 rounded-lg font-semibold transition-colors">Discard</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      <div className="lg:col-span-2">
        <div className="sticky top-16 z-20 border-b border-zinc-100 bg-white pb-3 pt-1 md:top-[6.5rem]">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-zinc-900">Product catalog</h1>
            <div className="flex items-center space-x-3 text-xs">
              <span className={`inline-flex items-center space-x-1.5 rounded-full px-2 py-0.5 ${isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span>{isOnline ? "Online" : "Offline Mode"}</span>
              </span>
              <span className="text-zinc-500">{syncStatus}</span>
              {pendingSales.length > 0 && (
                <button
                  onClick={() => setShowOfflineTray(true)}
                  className="flex items-center space-x-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 hover:bg-amber-200 transition-colors shadow-sm"
                >
                  <span className="font-semibold">{pendingSales.length}</span>
                  <span>pending</span>
                </button>
              )}
            </div>
          </div>
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />

          <button
            onClick={() => setCustomMode((v) => !v)}
            className="text-sm font-medium text-teal-700 hover:underline"
          >
            {customMode ? "Cancel custom sell" : "Can't find it? Sell as custom item"}
          </button>
        </div>

        {customMode && (
          <div className="mb-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
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
                type="text"
                inputMode="decimal"
                placeholder="Price sold for"
                value={customForm.price}
                onChange={(e) => setCustomForm({ ...customForm, price: e.target.value })}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                inputMode="numeric"
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
                        scrollToCart();
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

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 shadow-inner">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-500">
            <span>{products.length} product{products.length === 1 ? "" : "s"}</span>
            {products.length > 4 && <span>Scroll for more ↓</span>}
          </div>
          <div className="relative">
            <div ref={productListRef} className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pb-1 sm:grid-cols-2">
              {products.map((product) => {
                const expiryStatus = getExpiryStatus(product.expiryDate);
                return (
                  <button
                    key={product._id}
                    onClick={() => {
                      addToCart(product);
                      scrollToCart();
                    }}
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
            {products.length > 4 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-zinc-50 to-transparent" />
            )}
          </div>
        </div>
      </div>

      <div ref={cartSectionRef} className="scroll-mt-20 md:scroll-mt-32">
        {heldSales.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <button
              onClick={() => setShowHeld((v) => !v)}
              className="flex w-full items-center justify-between text-sm font-medium text-amber-800"
            >
              <span>Held sales ({heldSales.length})</span>
              <span>{showHeld ? "Hide" : "Show"}</span>
            </button>
            {showHeld && (
              <div className="mt-2 flex flex-col gap-2">
                {heldSales.map((held) => {
                  const heldTotal = held.cart.reduce((sum, line) => sum + lineAmount(line), 0);
                  return (
                    <div
                      key={held.id}
                      className="flex items-center justify-between rounded border border-amber-200 bg-white p-2 text-sm"
                    >
                      <div>
                        <div className="font-medium text-zinc-900">
                          {held.cart.length} item{held.cart.length === 1 ? "" : "s"} · ₦{heldTotal.toFixed(2)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          Held {new Date(held.heldAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => resumeHeldSale(held.id)}
                          className="text-xs font-medium text-teal-700 hover:underline"
                        >
                          Resume
                        </button>
                        <button
                          onClick={() => discardHeldSale(held.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Current sale</h2>
          
          <div className="flex items-center gap-4">
            <label className="hidden md:flex items-center gap-1.5 cursor-pointer rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 border border-teal-200">
              <input 
                type="checkbox" 
                checked={enablePrintListener} 
                onChange={(e) => setEnablePrintListener(e.target.checked)} 
                className="w-3.5 h-3.5 text-teal-600 rounded border-teal-300 focus:ring-teal-600"
              />
              🖨️ Listen for Phone Sales
            </label>
            
            {cart.length > 0 && (
              <div className="flex items-center gap-3">
                <button onClick={holdSale} className="text-xs font-medium text-amber-700 hover:underline">
                  Hold sale
                </button>
                <button onClick={clearCart} className="text-xs font-medium text-red-600 hover:underline">
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 pb-4 border-b border-zinc-100">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">Customer (EMR Patient)</label>
            <div 
              className="overflow-hidden transition-all duration-200" 
              style={{ height: `${Math.max(42, iframeHeight)}px` }}
            >
              <iframe 
                ref={iframeRef}
                src={`https://emr.psx.ng/embed/dispensary?pharmacyId=${pharmacyId}`}
                className="w-full h-full border-0"
                title="EMR Dispensary"
              />
            </div>
          </div>

          {loadingPrescription ? (
            <div className="flex flex-col items-center justify-center p-6 border border-zinc-100 rounded-lg bg-zinc-50/50">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-teal-600 mb-2"></div>
              <p className="text-xs text-zinc-500 font-medium">Loading EMR prescription...</p>
            </div>
          ) : cart.length === 0 ? (
            <p className="text-sm text-zinc-500">Cart is empty.</p>
          ) : (
            <div className="flex flex-col gap-3">
            {cart.map((line) => {
              if (line.kind === "custom") {
                return (
                  <div key={line.key} className="border-b border-zinc-100 pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-zinc-900">
                          {formatProductLabel(line)}{" "}
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            Not in catalog
                          </span>
                        </span>
                        {line.instruction && <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded w-max mt-0.5">{line.instruction}</span>}
                      </div>
                      <button onClick={() => removeLine(line.key)} className="text-xs text-red-600 hover:underline">
                        Remove
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={line.quantity === 0 ? "" : line.quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            updateLine(line.key, { quantity: 0 });
                            return;
                          }
                          const val = parseNumeric(raw);
                          if (!Number.isNaN(val)) {
                            updateLine(line.key, { quantity: Math.max(0, val) });
                          }
                        }}
                        onBlur={() => {
                          if (!line.quantity || line.quantity < 1) {
                            updateLine(line.key, { quantity: 1 });
                          }
                        }}
                        className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm text-center focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 font-medium"
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
              const maxQty = Math.max(1, Math.floor(line.product.quantityInStock / perForm));
              const priceForForm = line.product.retailPrice * perForm;
              return (
                <div key={line.key} className="border-b border-zinc-100 pb-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-zinc-900">{formatProductLabel(line.product)}</span>
                      {line.instruction && <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded w-max mt-0.5">{line.instruction}</span>}
                    </div>
                    <button
                      onClick={() => removeLine(line.key)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={line.quantity === 0 ? "" : line.quantity}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") {
                          updateLine(line.key, { quantity: 0 });
                          return;
                        }
                        const val = parseNumeric(raw);
                        if (!Number.isNaN(val)) {
                          updateLine(line.key, {
                            quantity: Math.max(0, Math.min(val, maxQty)),
                          });
                        }
                      }}
                      onBlur={() => {
                        if (!line.quantity || line.quantity < 1) {
                          updateLine(line.key, { quantity: 1 });
                        }
                      }}
                      className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm text-center focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 font-medium"
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
          )}

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
                        type="text"
                        inputMode="decimal"
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
                      type="text"
                      inputMode="decimal"
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
                onClick={openConfirmModal}
                disabled={submitting || !canCompleteSale}
                className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 shadow-sm"
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

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="border-b border-zinc-200 bg-zinc-50/80 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-zinc-900">Confirm Sale</h2>
                <p className="text-xs text-zinc-500">Please review order items and payment breakdown before completing.</p>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {currentCustomer.name && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white font-bold text-xs">
                    EMR
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-teal-800 uppercase tracking-wider block">Customer / Patient</span>
                    <span className="text-sm font-bold text-teal-950">{currentCustomer.name}</span>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Items to Purchase ({cart.length})</h3>
                <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                  {cart.map((line) => {
                    if (line.kind === "custom") {
                      const itemTotal = line.unitPrice * line.quantity;
                      return (
                        <div key={line.key} className="p-3 bg-white flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-zinc-900">
                              {formatProductLabel(line)}{" "}
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Custom</span>
                            </div>
                            <div className="text-xs text-zinc-500">
                              Qty: {line.quantity} × ₦{line.unitPrice.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-right text-sm font-bold text-zinc-900">
                            ₦{itemTotal.toFixed(2)}
                          </div>
                        </div>
                      );
                    }

                    const perForm = piecesPerForm(line.product, line.form);
                    const priceForForm = line.product.retailPrice * perForm;
                    const itemTotal = priceForForm * line.quantity;
                    return (
                      <div key={line.key} className="p-3 bg-white flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {formatProductLabel(line.product)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {line.quantity} {line.form}{line.quantity > 1 ? "s" : ""} × ₦{priceForForm.toFixed(2)}
                          </div>
                          {line.instruction && (
                            <div className="text-xs text-amber-700 font-medium mt-0.5">
                              Instruction: {line.instruction}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-sm font-bold text-zinc-900">
                          ₦{itemTotal.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Payment Breakdown</h4>
                  {payments.map((p, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-zinc-600">{PAYMENT_METHOD_LABEL[p.method]}:</span>
                      <span className="font-semibold text-zinc-900">₦{(parseNumeric(p.amount) || 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-zinc-200 pt-2 flex justify-between text-sm">
                    <span className="text-zinc-600">Total Tendered:</span>
                    <span className="font-semibold text-zinc-900">₦{amountTendered.toFixed(2)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-teal-100 bg-teal-50/30 p-4 space-y-2 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-teal-800">Total Due</h4>
                    <div className="text-2xl font-black text-teal-900">₦{total.toFixed(2)}</div>
                  </div>
                  {changeDue > 0.004 && (
                    <div className="border-t border-teal-200/60 pt-2 text-xs">
                      <div className="flex justify-between text-zinc-600">
                        <span>Change due:</span>
                        <span className="font-medium text-zinc-900">₦{changeDue.toFixed(2)}</span>
                      </div>
                      {changeFeeValue > 0 && (
                        <div className="flex justify-between text-zinc-600">
                          <span>Change fee:</span>
                          <span className="font-medium text-zinc-900">₦{changeFeeValue.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-bold text-teal-950 mt-1">
                        <span>Cash to hand back:</span>
                        <span>₦{cashToHandBack.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-200 bg-zinc-50 p-4 flex items-center justify-end">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={submitting}
                  className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  Back / Edit Sale
                </button>
                <button
                  type="button"
                  onClick={executeCompleteSale}
                  disabled={submitting}
                  className="rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-50 shadow-md flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Processing...
                    </>
                  ) : (
                    "Confirm & Complete Sale"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrintPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 duration-150 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 mb-4">
              <span className="text-2xl">✅</span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 mb-2">Sale Successful!</h2>
            <p className="text-sm text-zinc-500 mb-6">How would you like to handle the receipt?</p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={handleLocalPrint}
                className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 shadow-sm"
              >
                🖨️ Print Receipt Now
              </button>
              <button
                onClick={handleRemotePrint}
                disabled={submitting}
                className="w-full rounded-lg border border-teal-700 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
              >
                {submitting ? "Sending..." : "💻 Send to Computer Printer"}
              </button>
              <button
                onClick={handleNoPrint}
                disabled={submitting}
                className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 mt-2 disabled:opacity-50"
              >
                No Receipt Needed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
