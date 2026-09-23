"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatProductLabel, type PaymentMethod, type ProductCategory, type ProductJSON } from "@/lib/types";
import { getExpiryStatus, EXPIRY_BADGE_CLASS } from "@/lib/expiry";
import { computeBaseUnitsPerLevel, pluralize } from "@/lib/unitHierarchy";
import { parseNumeric } from "@/lib/numberInput";
import ReceiptTemplate, { type ReceiptSale } from "./ReceiptTemplate";
import { usePosOfflineSync } from "./usePosOfflineSync";
import { db } from "@/lib/db";
import { POS_SALE_MODE_KEY, type PosSaleMode } from "@/lib/posSaleMode";
import { fuzzyRank } from "@/lib/fuzzyMatch";

type CartLine =
  | {
      kind: "catalog";
      key: string;
      product: ProductJSON;
      form: string;
      quantity: number;
      instruction?: string;
      customPrice?: number;
      discountPercent?: number;
    }
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
      discountPercent?: number;
    };

// Never more than 25% off without an admin actually logged into this terminal — the
// admin-approval gate for a larger discount reuses the real login/role check rather than
// a new PIN system, same trust model as the wholesale-mode lock elsewhere on this screen.
const DISCOUNT_APPROVAL_THRESHOLD = 25;

function discountedUnitPrice(basePrice: number, discountPercent: number | undefined): number {
  if (!discountPercent) return basePrice;
  return basePrice * (1 - discountPercent / 100);
}

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

// The per-unit price this whole POS session sells catalog products at — retail or
// wholesale, chosen once at login (see PosSaleMode). A manually-typed customPrice
// override always wins regardless of mode; this is only the default.
function unitPriceFor(product: ProductJSON, mode: PosSaleMode): number {
  return mode === "wholesale" ? product.wholesalePrice : product.retailPrice;
}

function lineAmount(line: CartLine, mode: PosSaleMode): number {
  const base =
    line.kind === "catalog"
      ? line.customPrice !== undefined
        ? line.customPrice
        : unitPriceFor(line.product, mode) * piecesPerForm(line.product, line.form)
      : line.unitPrice;
  return discountedUnitPrice(base, line.discountPercent) * line.quantity;
}

function lineCost(line: CartLine): number {
  return line.kind === "catalog"
    ? (line.product.costPrice || 0) * piecesPerForm(line.product, line.form) * line.quantity
    : (line.unitCost || 0) * line.quantity;
}

// Per-line discount control — a red % stepper that sits beside a price field, plus the
// resulting discounted price shown underneath in red once a discount is set. Reused for
// catalog items (with and without a unit hierarchy) and custom items alike. Enforces the
// >25% admin-approval rule right here at the input level, not just on submit, so staff
// get immediate feedback instead of a rejected sale later.
// A boxed, labeled tile — used to give Qty/Price/Discount each their own clearly bounded
// spot in the cart line instead of everything running together inline.
function CartFieldTile({
  label,
  labelColor = "text-stone-500",
  borderColor = "border-stone-300",
  children,
}: {
  label: string;
  labelColor?: string;
  borderColor?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border-2 bg-stone-50 px-2 py-1.5 ${borderColor}`}>
      <div className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${labelColor}`}>{label}</div>
      {children}
    </div>
  );
}

function DiscountControl({
  value,
  onChange,
  isAdminSession,
}: {
  value: number | undefined;
  onChange: (percent: number | undefined) => void;
  isAdminSession: boolean;
}) {
  const [blocked, setBlocked] = useState(false);

  function apply(next: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    if (clamped > DISCOUNT_APPROVAL_THRESHOLD && !isAdminSession) {
      onChange(DISCOUNT_APPROVAL_THRESHOLD);
      setBlocked(true);
      return;
    }
    setBlocked(false);
    onChange(clamped === 0 ? undefined : clamped);
  }

  return (
    <div>
      <div className="flex items-center justify-center gap-0.5">
        <input
          type="text"
          inputMode="numeric"
          value={value ?? ""}
          placeholder="0"
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(undefined);
              setBlocked(false);
              return;
            }
            const val = parseNumeric(raw);
            if (!Number.isNaN(val)) apply(val);
          }}
          className="w-full min-w-0 rounded border border-red-300 px-1 py-0 h-6 text-center text-xs font-bold text-red-700 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
        />
        <span className="shrink-0 text-xs font-bold text-red-600">%</span>
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-0.5">
        <button
          type="button"
          onClick={() => apply((value ?? 0) - 1)}
          className="flex h-5 items-center justify-center rounded border border-red-300 text-xs font-bold leading-none text-red-700 hover:bg-red-50"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => apply((value ?? 0) + 1)}
          className="flex h-5 items-center justify-center rounded border border-red-300 text-xs font-bold leading-none text-red-700 hover:bg-red-50"
        >
          +
        </button>
      </div>
      {blocked && (
        <p className="mt-0.5 text-[9px] leading-tight text-red-500">
          Over 25% needs an admin logged in on this terminal.
        </p>
      )}
    </div>
  );
}

export default function PosClient({
  branchId,
  pharmacyId,
  pharmacyName,
  branchName,
  branchAddress,
  staffName,
  userRole,
}: {
  branchId: string | null;
  pharmacyId: string;
  pharmacyName?: string;
  branchName?: string;
  branchAddress?: string;
  staffName?: string;
  userRole?: string;
}) {
  const isAdminSession = userRole === "admin";
  const { isOnline, syncStatus, lastSyncedAt, pendingSales, syncPendingSales } = usePosOfflineSync(branchId);

  // Asked once per login (sessionStorage — cleared on sign-out, see clearPosSaleMode),
  // not stored per-device. A per-computer lock would go silently stale if a machine ever
  // got physically swapped between the retail and wholesale counters; asking fresh every
  // login means whoever's sitting there today makes the call today. null = not yet
  // answered this session, so the full-screen prompt below blocks the rest of the UI.
  const [saleMode, setSaleMode] = useState<PosSaleMode | null>(null);
  const [saleModeReady, setSaleModeReady] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(POS_SALE_MODE_KEY);
      if (saved === "retail" || saved === "wholesale") setSaleMode(saved);
    } catch {
      // sessionStorage can throw in a locked-down browser context — just fall through to the prompt.
    }
    setSaleModeReady(true);
  }, []);
  function chooseSaleMode(mode: PosSaleMode) {
    setSaleMode(mode);
    try {
      sessionStorage.setItem(POS_SALE_MODE_KEY, mode);
    } catch {
      // Worst case it re-prompts on the next reload — never block selling over storage failing.
    }
  }

  const [showOfflineTray, setShowOfflineTray] = useState(false);
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Set when a barcode scan finds no match locally or on the server — most of the
  // catalog came from an AI photo-extraction pipeline with no barcode on file yet, so a
  // miss is common and expected. Holding the scanned code here lets us link it to
  // whatever product the cashier picks next via the normal name search, instead of the
  // scan just silently doing nothing.
  const [pendingScanBarcode, setPendingScanBarcode] = useState<string | null>(null);
  const [barcodeLinkToast, setBarcodeLinkToast] = useState<string | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [changeFee, setChangeFee] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [iframeHeight, setIframeHeight] = useState(42);
  const [loadingPrescription, setLoadingPrescription] = useState(false);
  const [currentCustomer, setCurrentCustomer] = useState<{ id: string | null; name: string | null; encounterId: string | null }>({ id: null, name: null, encounterId: null });
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [ailment, setAilment] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [enablePrintListener, setEnablePrintListener] = useState(false);
  const [lastSale, setLastSale] = useState<ReceiptSale | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<{ url: string; name: string } | null>(null);

  // Quick edit — press-and-hold (touch) or right-click (mouse) a product tile to adjust
  // stock/price/etc without leaving POS, admin-only, same fields and endpoint as the
  // Catalog page's own "Edit" row (PATCH /api/products/[id], which itself requires an
  // admin session server-side — this client-side isAdminSession check is just so
  // non-admin staff never see the option, not the actual enforcement).
  const [quickEditProduct, setQuickEditProduct] = useState<ProductJSON | null>(null);
  const [quickEditForm, setQuickEditForm] = useState({
    itemName: "",
    brand: "",
    size: "",
    category: "medicine" as ProductCategory,
    quantityInStock: "",
    costPrice: "",
    retailPrice: "",
    wholesalePrice: "",
    distributorPrice: "",
    batchNumber: "",
    expiryDate: "",
  });
  const [quickEditSaving, setQuickEditSaving] = useState(false);
  const [quickEditError, setQuickEditError] = useState("");
  // Long-press detection for touch devices — a single shared timer/flag is fine since only
  // one tile can be actively pressed at a time. The flag suppresses the synthetic click that
  // still fires on touchend after a long press, so long-pressing a tile never also adds it
  // to the cart.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const LONG_PRESS_MS = 550;

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
        
        const allProducts = await db.products.toArray();

        for (const med of medicines) {
          if (!med || !med.name) continue;
          
          try {
            let foundProduct = null;
            
            if (med.productId) {
              foundProduct = allProducts.find(p => p._id === med.productId) || null;
            }
            
            if (!foundProduct) {
              const query = med.name.toLowerCase();
              foundProduct = allProducts.find(p => 
                (p.itemName && p.itemName.toLowerCase().includes(query)) ||
                (p.brand && p.brand.toLowerCase().includes(query))
              ) || null;
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
  // Keyed on `products` (the actual rendered result set), not the raw `search` keystroke —
  // search is debounced 300ms before it drives a refetch, so resetting on every keystroke
  // reset the scroll well before the new results actually landed in the DOM. If the cashier
  // scrolled again in that gap (e.g. right after their last keystroke, before the debounce
  // fired), `search` had already stopped changing and this effect never ran again, so the
  // list quietly kept whatever scroll position it had when the new results finally swapped in.
  useEffect(() => {
    productListRef.current?.scrollTo(0, 0);
  }, [products]);

  // A native scrollbar — even styled via CSS — rendered inconsistently across
  // browsers/OS scrollbar settings and was still easy for less computer-literate staff to
  // miss. This draws our own thick, high-contrast, draggable scroll thumb next to the
  // results box instead, so its appearance is guaranteed rather than left up to how each
  // browser feels like honoring ::-webkit-scrollbar that day.
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, height: 0, clientHeight: 0 });
  function syncScrollMetrics() {
    const el = productListRef.current;
    if (!el) return;
    setScrollMetrics({ top: el.scrollTop, height: el.scrollHeight, clientHeight: el.clientHeight });
  }
  // ResizeObserver instead of a `[products]`-keyed effect — the effect fired on the state
  // change, not on the actual DOM reflow, so it could read a stale scrollHeight (e.g. images
  // still loading, grid not yet re-laid-out) and leave the scrollbar thinking there's more
  // content below than there really is, letting staff scroll into empty space past the last
  // real result. Watching the element itself keeps metrics accurate to what's really rendered.
  useEffect(() => {
    const el = productListRef.current;
    if (!el) return;
    syncScrollMetrics();
    const observer = new ResizeObserver(() => syncScrollMetrics());
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [products]);
  const scrollThumbRef = useRef<HTMLDivElement>(null);
  function handleScrollTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const track = e.currentTarget;
    const el = productListRef.current;
    if (!el) return;
    (e.target as Element).setPointerCapture(e.pointerId);

    const scrollToPointer = (clientY: number) => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    };
    scrollToPointer(e.clientY);

    const onMove = (moveEvent: PointerEvent) => scrollToPointer(moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (branchId) params.set("branchId", branchId);
    return params.toString();
  }

  useEffect(() => {
    const fetchProducts = async () => {
      const trimmedSearch = debouncedSearch.trim();
      const allProducts = await db.products.toArray();

      // Ranked, not just filtered — was a literal substring match with results sliced to
      // 50 in whatever order came back, unranked. That meant a broad query with >50
      // matches could bury the exact item you wanted, and typing MORE of its name (which
      // should only ever narrow an already-good result set) was sometimes the only way to
      // get it under the cap — the opposite of how search should behave. Fixed with the
      // same fuzzy approach already proven in triage: strip spaces/punctuation/case before
      // comparing, then rank by similarity so the best 50 matches always win the cutoff,
      // not an arbitrary 50. Barcode stays an exact/literal check — fuzzy-matching a scan
      // code is how you ring up the wrong item.
      const barcodeMatches = trimmedSearch
        ? allProducts.filter((p) => p.barcode && p.barcode.includes(trimmedSearch))
        : [];
      const ranked = trimmedSearch
        ? fuzzyRank(trimmedSearch, allProducts, (p) => `${p.itemName ?? ""} ${p.brand ?? ""}`, {
            limit: 50,
            minScore: 0.2,
          })
        : [...allProducts].sort((a, b) => (a.itemName || "").localeCompare(b.itemName || "")).slice(0, 50);
      const seenIds = new Set(barcodeMatches.map((p) => p._id));
      const filtered = [...barcodeMatches, ...ranked.filter((p) => !seenIds.has(p._id))].slice(0, 50);

      // The local IndexedDB cache only refreshes on mount/branch-change/reconnect (see
      // usePosOfflineSync) — a product added moments ago (e.g. a bulk catalog publish)
      // can be invisible here for a few seconds while that background sync catches up.
      // Same fallback the barcode-scanner path already uses below: a cache miss on a
      // real search term also checks the live server before giving up, so a cashier
      // never sees "not found" for something that genuinely exists.
      if (filtered.length === 0 && trimmedSearch && navigator.onLine) {
        try {
          const params = new URLSearchParams({ search: debouncedSearch });
          if (branchId) params.set("branchId", branchId);
          const res = await fetch(`/api/products?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            setProducts((data.products ?? []).slice(0, 50));
            return;
          }
        } catch (e) {
          console.error("Live search fallback error", e);
        }
      }

      setProducts(filtered as unknown as ProductJSON[]);
    };
    fetchProducts();
  }, [debouncedSearch, branchId]);

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
        
        const allProducts = await db.products.toArray();
        const matchedProduct = allProducts.find(p => p.barcode === scannedCode);

        if (matchedProduct) {
          addToCart(matchedProduct as unknown as ProductJSON);
          scrollToCart();
          return;
        }

        if (navigator.onLine) {
          const params = new URLSearchParams({ search: scannedCode });
          if (branchId) params.set("branchId", branchId);

          try {
            const res = await fetch(`/api/products?${params.toString()}`);
            if (res.ok) {
              const data = await res.json();
              const remoteMatch = data.products.find((p: ProductJSON) => p.barcode === scannedCode);
              if (remoteMatch) {
                addToCart(remoteMatch);
                scrollToCart();
                return;
              }
            }
          } catch (e) {
            console.error("Barcode remote fallback error", e);
          }
        }

        // No match anywhere — don't fail silently. Let the cashier recover by finding
        // the item by name (same search box, same addToCart flow), and remember the
        // scanned code so it gets linked to whatever they pick.
        setPendingScanBarcode(scannedCode);
        setSearch("");
        setBarcodeLinkToast(null);
        searchInputRef.current?.focus();
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
    flashCartLine(product._id);
  }

  // --------------- Quick edit (press-and-hold / right-click a tile) ---------------
  function openQuickEdit(product: ProductJSON) {
    setQuickEditProduct(product);
    setQuickEditForm({
      itemName: product.itemName,
      brand: product.brand,
      size: product.size,
      category: product.category,
      quantityInStock: String(product.quantityInStock),
      costPrice: String(product.costPrice || 0),
      retailPrice: String(product.retailPrice),
      wholesalePrice: String(product.wholesalePrice),
      distributorPrice: String(product.distributorPrice),
      batchNumber: product.batchNumber || "",
      expiryDate: product.expiryDate ? String(product.expiryDate).slice(0, 10) : "",
    });
    setQuickEditError("");
  }

  function closeQuickEdit() {
    setQuickEditProduct(null);
    setQuickEditError("");
  }

  async function saveQuickEdit() {
    if (!quickEditProduct) return;
    if (!quickEditForm.itemName.trim()) {
      setQuickEditError("Item name is required.");
      return;
    }
    if (!quickEditForm.brand.trim()) {
      setQuickEditError("Brand is required.");
      return;
    }
    if (!quickEditForm.size.trim()) {
      setQuickEditError('Size is required — use "Standard" if the item has no size/strength variation.');
      return;
    }
    setQuickEditSaving(true);
    setQuickEditError("");
    try {
      const res = await fetch(`/api/products/${quickEditProduct._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          itemName: quickEditForm.itemName,
          brand: quickEditForm.brand,
          size: quickEditForm.size,
          category: quickEditForm.category,
          quantityInStock: quickEditForm.quantityInStock,
          costPrice: quickEditForm.costPrice,
          retailPrice: quickEditForm.retailPrice,
          wholesalePrice: quickEditForm.wholesalePrice,
          distributorPrice: quickEditForm.distributorPrice,
          batchNumber: quickEditForm.batchNumber,
          expiryDate: quickEditForm.expiryDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update product");
      const updated = data.product as ProductJSON;
      // Reflect immediately in the tile grid, and keep the offline IndexedDB cache
      // (which is what products actually renders from — see the fetchProducts effect
      // above) in sync so the new values survive a reload/offline session too.
      setProducts((prev) => prev.map((p) => (p._id === updated._id ? updated : p)));
      db.products.put(updated).catch(() => {});
      setQuickEditProduct(null);
    } catch (err) {
      setQuickEditError(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setQuickEditSaving(false);
    }
  }

  function handleTileTouchStart(product: ProductJSON) {
    if (!isAdminSession) return;
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      openQuickEdit(product);
    }, LONG_PRESS_MS);
  }

  function cancelTileLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Called alongside addToCart (never instead of it, and never blocking it) when the
  // cashier picks a product from name search right after a barcode scan came up with no
  // match. Links the originally-scanned code to that product so the same item scans
  // directly next time — server write is fire-and-forget, local cache is updated right
  // away so THIS device can re-scan it immediately without waiting on the next sync.
  function linkPendingScanBarcode(product: ProductJSON) {
    const scannedCode = pendingScanBarcode;
    if (!scannedCode) return;
    setPendingScanBarcode(null);

    fetch(`/api/products/${product._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode: scannedCode, branchId }),
    }).catch((e) => console.error("Barcode link save failed", e));

    db.products.update(product._id, { barcode: scannedCode }).catch((e) =>
      console.error("Barcode link local cache update failed", e)
    );

    setBarcodeLinkToast(`Barcode saved to ${product.itemName} — it'll scan directly next time.`);
    window.setTimeout(() => setBarcodeLinkToast((t) => (t?.startsWith(`Barcode saved to ${product.itemName}`) ? null : t)), 3500);
  }

  // Cart sits sticky alongside the catalog now (see the grid wrapper below), so a click
  // doesn't need to jump the page — but a quiet position change alone is easy to miss.
  // This briefly highlights the exact line that changed so it's unmistakable that the
  // click actually landed, even for someone not looking at the cart at that instant.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  function flashCartLine(key: string) {
    setFlashKey(key);
    window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 1200);
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
    setCustomerName("");
    setCustomerPhone("");
    setAilment("");
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
    setMessage(null);
  }

  const effectiveSaleMode: PosSaleMode = saleMode ?? "retail";
  const total = useMemo(
    () => cart.reduce((sum, line) => sum + lineAmount(line, effectiveSaleMode), 0),
    [cart, effectiveSaleMode]
  );

  // Close matches for whatever the staff is typing as a custom item's name, so they can bail
  // into the normal add-to-cart flow if it turns out the item actually is in the catalog.
  useEffect(() => {
    if (!customMode || !customForm.itemName.trim()) {
      const timeout = setTimeout(() => setCustomMatches([]), 0);
      return () => clearTimeout(timeout);
    }
    const timeout = setTimeout(async () => {
      try {
        const query = customForm.itemName.trim().toLowerCase();
        const allProducts = await db.products.toArray();
        const filtered = allProducts.filter(p => 
          (p.itemName && p.itemName.toLowerCase().includes(query)) ||
          (p.brand && p.brand.toLowerCase().includes(query))
        );
        setCustomMatches(filtered.slice(0, 5) as unknown as ProductJSON[]);
      } catch (e: any) {
        console.error("Custom search error", e);
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [customMode, customForm.itemName]);

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

    const newKey = `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setCart((prev) => [
      ...prev,
      {
        kind: "custom",
        key: newKey,
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
    flashCartLine(newKey);
    scrollToCart();
  }

  function handleAddTreatment() {
    const priceStr = window.prompt("Enter price for Treatment (₦):");
    if (priceStr === null) return; // User cancelled
    const price = parseNumeric(priceStr);
    if (!Number.isFinite(price) || price <= 0) {
      alert("Invalid price entered.");
      return;
    }
    setCart((prev) => [
      ...prev,
      {
        kind: "custom",
        key: `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemName: "Treatment",
        brand: "Clinic",
        size: "Standard",
        category: "non-medicine",
        unitPrice: price,
        unitCost: 0,
        quantity: 1,
      },
    ]);
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
            priceTier: effectiveSaleMode,
            unitPrice: line.customPrice,
            discountPercent: line.discountPercent,
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
            discountPercent: line.discountPercent,
          }
    );

    const effectiveCustomerName = currentCustomer.name || customerName.trim() || undefined;

    const payload = {
      branchId,
      customerId: currentCustomer.id,
      customerName: effectiveCustomerName,
      customerPhone: customerPhone.trim() || undefined,
      ailment: ailment.trim() || undefined,
      payments: payments.map((p) => ({ method: p.method, amount: parseNumeric(p.amount) })),
      changeFee: changeFeeValue,
      items: payloadItems,
    };

    if (!isOnline) {
      const offlineReceiptNumber = `OFF-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;
      await db.pendingSales.add({
        offlineReceiptNumber,
        customerName: effectiveCustomerName,
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
      setCustomerName("");
      setAilment("");
      setCustomerPhone("");
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
    setCustomerName("");
    setAilment("");
    setCustomerPhone("");
    setPayments([{ method: "cash", amount: "" }]);
    setPaymentsTouched(false);
    setChangeFee("0");
    const query = debouncedSearch.toLowerCase();
    const allProducts = await db.products.toArray();
    const filtered = allProducts.filter(p => 
      (p.itemName && p.itemName.toLowerCase().includes(query)) ||
      (p.brand && p.brand.toLowerCase().includes(query)) ||
      (p.barcode && p.barcode.includes(query))
    );
    setProducts(filtered.slice(0, 50) as unknown as ProductJSON[]);
    
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

  // Block everything else until this login session has answered — see saleMode above
  // for why this is asked fresh every login instead of locked to the computer.
  if (!saleModeReady) {
    return null;
  }

  if (!saleMode) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="px-6 pt-6 pb-4 text-center border-b border-zinc-100">
            <h1 className="text-lg font-bold text-zinc-900">Selling to a retail customer, or a wholesaler?</h1>
            <p className="mt-1 text-sm text-zinc-500">
              This sets the price for every sale until you sign out{staffName ? ` — ${staffName}` : ""}.
            </p>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <button
              onClick={() => chooseSaleMode("retail")}
              className="w-full rounded-xl border-2 border-teal-600 bg-teal-50 px-5 py-4 text-left hover:bg-teal-100 transition-colors"
            >
              <div className="text-base font-bold text-teal-800">🏪 Retail</div>
              <div className="text-xs text-teal-700">Normal shop prices</div>
            </button>
            <button
              onClick={() => chooseSaleMode("wholesale")}
              className="w-full rounded-xl border-2 border-amber-500 bg-amber-50 px-5 py-4 text-left hover:bg-amber-100 transition-colors"
            >
              <div className="text-base font-bold text-amber-800">📦 Wholesale</div>
              <div className="text-xs text-amber-700">Bulk buyer prices</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {effectiveSaleMode === "wholesale" && (
        <div className="lg:col-span-5 rounded-xl border-2 border-amber-400 bg-amber-100 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-bold text-amber-900">📦 WHOLESALE MODE — every sale on this screen charges wholesale price</span>
          <button
            onClick={() => {
              setSaleMode(null);
              try {
                sessionStorage.removeItem(POS_SALE_MODE_KEY);
              } catch {
                // fine — the prompt just re-shows on next reload instead
              }
            }}
            className="text-xs font-semibold text-amber-900 underline hover:no-underline shrink-0 ml-3"
          >
            Not right? Switch
          </button>
        </div>
      )}
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
      <div className="lg:col-span-3 flex flex-col lg:h-[calc(100vh-6.5rem)] lg:overflow-hidden">
        <div className="sticky top-16 lg:static z-20 shrink-0 border-b border-zinc-100 bg-white pb-3 pt-1 md:top-[6.5rem]">
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
          {pendingScanBarcode && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <span>Scanned code &quot;{pendingScanBarcode}&quot; not recognized — search by name below to link it.</span>
              <button
                onClick={() => setPendingScanBarcode(null)}
                className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-200"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="relative mb-2">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-2 border-stone-300 bg-white px-3 py-2 pr-16 text-sm font-medium focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-300"
              >
                Clear
              </button>
            )}
          </div>

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
              className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700"
            >
              Add custom item to cart
            </button>
          </div>
        )}

        <div className="flex flex-1 min-h-0 flex-col rounded-xl border-2 border-stone-300 bg-stone-100 p-3 shadow-sm">
          {products.length > 4 && (
            <div className="mb-2 flex items-center justify-end text-xs font-bold uppercase tracking-wide text-stone-500">
              <span className="font-bold text-emerald-700 normal-case tracking-normal">▼ Scroll for more — this list keeps going</span>
            </div>
          )}
          <div className="relative flex-1 min-h-0">
            <div
              ref={productListRef}
              onScroll={syncScrollMetrics}
              className="pos-results-scroll grid h-full content-start grid-cols-1 gap-2 overflow-y-auto pb-1 pr-6 sm:grid-cols-2"
            >
              {/* Hardcoded Treatment Item */}
              <button
                onClick={handleAddTreatment}
                className="flex flex-col rounded-lg border-2 border-teal-300 bg-teal-50 p-3 text-left shadow-sm hover:border-teal-600 transition-colors"
              >
                <span className="text-sm font-semibold text-teal-900">Treatment</span>
                <span className="mt-1 text-xs text-teal-700">Non-medicine</span>
                <div className="mt-2 flex items-center justify-between">
                  <span className="rounded bg-teal-200/50 px-2 py-0.5 text-xs font-bold text-teal-800">
                    Dynamic Price
                  </span>
                  <span className="text-xs text-teal-600 font-medium">Click to bill →</span>
                </div>
              </button>

              {products.slice(0, 100).map((product) => {
                const expiryStatus = getExpiryStatus(product.expiryDate);
                return (
                  <button
                    key={product._id}
                    onClick={() => {
                      if (longPressTriggeredRef.current) {
                        longPressTriggeredRef.current = false;
                        return;
                      }
                      addToCart(product);
                      if (pendingScanBarcode) linkPendingScanBarcode(product);
                      scrollToCart();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isAdminSession) openQuickEdit(product);
                    }}
                    onTouchStart={() => handleTileTouchStart(product)}
                    onTouchEnd={cancelTileLongPress}
                    onTouchMove={cancelTileLongPress}
                    disabled={product.quantityInStock < 1}
                    className="flex flex-col rounded-lg border-2 border-stone-300 bg-white p-3 text-left shadow-sm hover:border-teal-600 hover:shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {product.imageUrl ? (
                          <img
                            src={`/_next/image?url=${encodeURIComponent(product.imageUrl)}&w=64&q=50`}
                            alt={product.itemName}
                            className="h-8 w-8 shrink-0 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEnlargedImage({ url: product.imageUrl!, name: product.itemName });
                            }}
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-400">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                              <line x1="12" y1="22.08" x2="12" y2="12"></line>
                            </svg>
                          </div>
                        )}
                        <span className="font-bold uppercase tracking-tight text-zinc-900">{formatProductLabel(product)}</span>
                      </div>
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
                      ₦{unitPriceFor(product, effectiveSaleMode).toFixed(2)}
                      {effectiveSaleMode === "wholesale" && (
                        <span className="ml-1 text-xs font-normal text-amber-700">(wholesale)</span>
                      )}
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
            {products.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={scrollMetrics.top <= 1}
                  onClick={() => productListRef.current?.scrollBy({ top: -160, behavior: "smooth" })}
                  aria-label="Scroll up"
                  className="absolute top-0 right-0 flex h-7 w-5 items-center justify-center rounded-t-md border border-emerald-300 bg-emerald-600 text-xs font-bold leading-none text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
                >
                  ▲
                </button>
                <div
                  onPointerDown={handleScrollTrackPointerDown}
                  className="absolute top-8 bottom-8 right-0 w-5 cursor-pointer rounded-full bg-emerald-100 border border-emerald-200"
                >
                  <div
                    ref={scrollThumbRef}
                    className="absolute left-0 right-0 rounded-full bg-emerald-700 shadow-sm"
                    style={{
                      height: `${
                        scrollMetrics.height > scrollMetrics.clientHeight
                          ? Math.max(10, (scrollMetrics.clientHeight / scrollMetrics.height) * 100)
                          : 100
                      }%`,
                      top: `${
                        scrollMetrics.height > scrollMetrics.clientHeight
                          ? (scrollMetrics.top / (scrollMetrics.height - scrollMetrics.clientHeight)) *
                            (100 - Math.max(10, (scrollMetrics.clientHeight / scrollMetrics.height) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  disabled={scrollMetrics.height - scrollMetrics.clientHeight - scrollMetrics.top <= 1}
                  onClick={() => productListRef.current?.scrollBy({ top: 160, behavior: "smooth" })}
                  aria-label="Scroll down"
                  className="absolute bottom-0 right-0 flex h-7 w-5 items-center justify-center rounded-b-md border border-emerald-300 bg-emerald-600 text-xs font-bold leading-none text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600"
                >
                  ▼
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        ref={cartSectionRef}
        className="lg:col-span-2 scroll-mt-20 md:scroll-mt-32 rounded-xl border-2 border-stone-300 bg-stone-100 p-4 shadow-sm lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto flex flex-col"
      >
        {heldSales.length > 0 && (
          <div className="mb-3 shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-3">
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
                  const heldTotal = held.cart.reduce((sum, line) => sum + lineAmount(line, effectiveSaleMode), 0);
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

        <div className="mb-3 shrink-0 flex flex-wrap items-center justify-between gap-y-2">
          <h2 className="text-lg font-extrabold uppercase tracking-tight text-zinc-900 sm:text-xl">Current Sale</h2>

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
        <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4 pb-4 shrink-0 border-b border-zinc-100">
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
            // No internal scroll region here — the item list renders at its natural
            // height, and the whole Current Sale column (see its lg:overflow-y-auto
            // above) scrolls as one unit when everything doesn't fit. An earlier version
            // tried to keep the Total/Payment/Complete Sale footer always in view by
            // giving just this list its own bounded, independently-scrolling area, but
            // that meant this area and the footer were fighting over the same fixed
            // height budget, which kept leaving this list too small to be usable. One
            // native scroll on the whole panel is simpler and was verified to actually
            // work, at the cost of the footer no longer always being pinned in view.
            <div className="flex flex-col gap-3">
            {cart.map((line) => {
  if (line.kind === "custom") {
    return (
      <div
        key={line.key}
        className={`relative flex justify-between items-start py-2.5 border-b border-zinc-200 transition-colors duration-700 ${
          flashKey === line.key ? "bg-emerald-50" : "bg-transparent"
        }`}
      >
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 pr-4">
          <div className="flex flex-col">
            <span className="text-[13px] font-bold text-slate-700 uppercase tracking-tight leading-tight truncate" title={formatProductLabel(line)}>
              {formatProductLabel(line)} <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-800 ml-1">CUSTOM</span>
            </span>
            {line.instruction && <span className="text-[11px] text-amber-600 mt-0.5 truncate">{line.instruction}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-1">
            <div className="flex items-center rounded border border-slate-300 bg-white h-7 overflow-hidden shrink-0 shadow-sm">
              <button 
                className="px-2 text-slate-500 font-bold hover:bg-slate-100 active:bg-slate-200"
                onClick={() => updateLine(line.key, { quantity: Math.max(0, (line.quantity || 0) - 1) })}
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={line.quantity === 0 ? "" : line.quantity}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") { updateLine(line.key, { quantity: 0 }); return; }
                  const val = parseNumeric(raw);
                  if (!Number.isNaN(val)) updateLine(line.key, { quantity: Math.max(0, val) });
                }}
                onBlur={() => {
                  if (!line.quantity || line.quantity < 1) updateLine(line.key, { quantity: 1 });
                }}
                className="w-8 text-center text-[13px] font-bold focus:outline-none focus:bg-teal-50"
              />
              <button 
                className="px-2 text-slate-500 font-bold hover:bg-slate-100 active:bg-slate-200"
                onClick={() => updateLine(line.key, { quantity: (line.quantity || 0) + 1 })}
              >
                +
              </button>
            </div>

            <div className="flex items-center text-slate-600 font-medium text-[13px]">
              <div className="flex items-center border border-slate-300 rounded bg-white h-7 px-1.5 shadow-sm focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
                <span className="text-slate-400 text-xs mr-0.5">₦</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.unitPrice === 0 ? "" : line.unitPrice}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") { updateLine(line.key, { unitPrice: 0 }); return; }
                    const val = parseNumeric(raw);
                    if (!Number.isNaN(val)) updateLine(line.key, { unitPrice: val });
                  }}
                  className="w-14 bg-transparent outline-none text-center font-bold text-[13px] text-slate-700"
                />
              </div>
              <span className="text-slate-400 mx-1.5 font-normal">×</span> {line.quantity}
            </div>
            
            <div className="flex items-center ml-2 border-l border-slate-200 pl-2">
               <span className="text-[10px] text-slate-400 mr-1">DISC</span>
               <div className="w-16">
                 <DiscountControl
                    value={line.discountPercent}
                    onChange={(percent) => updateLine(line.key, { discountPercent: percent })}
                    isAdminSession={isAdminSession}
                  />
               </div>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col justify-between items-end shrink-0 w-24 min-h-[50px] relative">
          <button
            onClick={() => removeLine(line.key)}
            className="h-5 w-5 rounded bg-red-400/80 hover:bg-red-500 text-white flex items-center justify-center shadow-sm absolute top-0 right-0 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>

          <div className="mt-8 text-right flex flex-col justify-end w-full">
            {line.discountPercent ? (
              <>
                <span className="text-[10px] text-slate-400 line-through">₦{(line.unitPrice * line.quantity).toFixed(2)}</span>
                <span className="text-[15px] font-black text-red-600">₦{lineAmount(line, effectiveSaleMode).toFixed(2)}</span>
              </>
            ) : (
              <span className="text-[15px] font-black text-slate-800 tracking-tight">₦{(line.unitPrice * line.quantity).toFixed(2)}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const hierarchy = line.product.unitHierarchy;
  const perForm = piecesPerForm(line.product, line.form);
  const maxQty = Math.max(1, Math.floor(line.product.quantityInStock / perForm));
  const priceForForm = line.customPrice !== undefined ? line.customPrice : unitPriceFor(line.product, effectiveSaleMode) * perForm;
  
  return (
    <div
      key={line.key}
      className={`relative flex justify-between items-start py-2.5 border-b border-zinc-200 transition-colors duration-700 ${
        flashKey === line.key ? "bg-emerald-50" : "bg-transparent"
      }`}
    >
      <div className="flex flex-col gap-1 flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2">
          {line.product.imageUrl && (
            <img
              src={`/_next/image?url=${encodeURIComponent(line.product.imageUrl)}&w=64&q=50`}
              alt={line.product.itemName}
              className="h-6 w-6 shrink-0 rounded object-cover border border-slate-200 cursor-pointer hover:opacity-80"
              onClick={(e) => {
                e.stopPropagation();
                if (line.product.imageUrl) setEnlargedImage({ url: line.product.imageUrl, name: line.product.itemName });
              }}
            />
          )}
          <span className="text-[13px] font-bold text-slate-700 uppercase tracking-tight leading-tight truncate" title={formatProductLabel(line.product)}>
            {formatProductLabel(line.product)}
          </span>
        </div>
        {line.instruction && <span className="text-[11px] text-amber-600 truncate">{line.instruction}</span>}

        <div className="flex flex-wrap items-center gap-2 mt-1">
          <div className="flex items-center rounded border border-slate-300 bg-white h-7 overflow-hidden shrink-0 shadow-sm">
            <button 
              className="px-2 text-slate-500 font-bold hover:bg-slate-100 active:bg-slate-200"
              onClick={() => updateLine(line.key, { quantity: Math.max(0, (line.quantity || 0) - 1) })}
            >
              -
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={line.quantity === 0 ? "" : line.quantity}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") { updateLine(line.key, { quantity: 0 }); return; }
                const val = parseNumeric(raw);
                if (!Number.isNaN(val)) {
                  updateLine(line.key, { quantity: Math.max(0, Math.min(val, maxQty)) });
                }
              }}
              onBlur={() => {
                if (!line.quantity || line.quantity < 1) updateLine(line.key, { quantity: 1 });
              }}
              className="w-8 text-center text-[13px] font-bold focus:outline-none focus:bg-teal-50"
            />
            <button 
              className="px-2 text-slate-500 font-bold hover:bg-slate-100 active:bg-slate-200"
              onClick={() => {
                const newVal = (line.quantity || 0) + 1;
                updateLine(line.key, { quantity: Math.min(newVal, maxQty) });
              }}
            >
              +
            </button>
          </div>

          {hierarchy && hierarchy.length > 0 && (
            <select
              value={line.form}
              onChange={(e) => {
                const newForm = e.target.value;
                const newMax = Math.floor(line.product.quantityInStock / piecesPerForm(line.product, newForm));
                updateLine(line.key, { form: newForm, quantity: Math.min(1, newMax) || 1 });
              }}
              className="h-7 rounded border border-slate-300 px-1 py-0 text-[11px] font-bold focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-white cursor-pointer uppercase text-slate-600"
            >
              {hierarchy.map((level) => (
                <option key={level.unitName} value={level.unitName}>
                  {pluralize(level.unitName, 2)}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center text-slate-600 font-medium text-[13px]">
            <div className={`flex items-center border border-slate-300 rounded bg-white h-7 px-1.5 shadow-sm ${unitPriceFor(line.product, effectiveSaleMode) === 0 ? "focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500" : ""}`}>
              <span className="text-slate-400 text-xs mr-0.5">₦</span>
              <input
                type="text"
                inputMode="decimal"
                disabled={unitPriceFor(line.product, effectiveSaleMode) > 0}
                value={line.customPrice !== undefined ? line.customPrice : (unitPriceFor(line.product, effectiveSaleMode) * perForm)}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") { updateLine(line.key, { customPrice: 0 }); return; }
                  const val = parseNumeric(raw);
                  if (!Number.isNaN(val)) updateLine(line.key, { customPrice: val });
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim()) updateLine(line.key, { customPrice: undefined });
                }}
                className={`w-14 bg-transparent outline-none text-center font-bold text-[13px] text-slate-700 ${unitPriceFor(line.product, effectiveSaleMode) > 0 ? "cursor-default opacity-80" : ""}`}
              />
            </div>
            <span className="text-slate-400 mx-1.5 font-normal">×</span> {line.quantity}
          </div>
          
          <div className="flex items-center ml-2 border-l border-slate-200 pl-2">
             <span className="text-[10px] text-slate-400 mr-1">DISC</span>
             <div className="w-16">
               <DiscountControl
                  value={line.discountPercent}
                  onChange={(percent) => updateLine(line.key, { discountPercent: percent })}
                  isAdminSession={isAdminSession}
                />
             </div>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col justify-between items-end shrink-0 w-24 min-h-[50px] relative">
        <button
          onClick={() => removeLine(line.key)}
          className="h-5 w-5 rounded bg-red-400/80 hover:bg-red-500 text-white flex items-center justify-center shadow-sm absolute top-0 right-0 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div className="mt-8 text-right flex flex-col justify-end w-full">
          {line.discountPercent ? (
            <>
              <span className="text-[10px] text-slate-400 line-through">₦{(priceForForm * line.quantity).toFixed(2)}</span>
              <span className="text-[15px] font-black text-red-600">₦{lineAmount(line, effectiveSaleMode).toFixed(2)}</span>
            </>
          ) : (
            <span className="text-[15px] font-black text-slate-800 tracking-tight">₦{(priceForForm * line.quantity).toFixed(2)}</span>
          )}
        </div>
      </div>
    </div>
  );
})}
            </div>
          )}
          </div>
          {/* Total/Payment/Complete Sale footer, at its own natural height below the
              cart-items box — see the lg:overflow-y-auto on the outer column (above,
              cartSectionRef) for how the whole panel scrolls as one unit when this plus
              the item list don't all fit, instead of this footer competing with the item
              list over a shared fixed-height budget. */}

          {cart.length > 0 && (
            <div className="mt-3 shrink-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold uppercase tracking-wide text-zinc-900">Total</span>
                <span className="text-xl font-extrabold text-zinc-900">₦{total.toFixed(2)}</span>
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

              {/* Optional EMR Clinical Condition/Complaint — not relevant for a wholesale
                  buyer, so this whole card (and the customer-linking fields inside it)
                  is skipped in wholesale mode rather than left showing an empty patient
                  workflow for what's actually a business sale. */}
              {effectiveSaleMode !== "wholesale" && (
              <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-teal-900 flex items-center gap-1.5">
                    <span>🩺</span> Complaint / Ailment
                  </span>
                  <span className="text-[10px] font-semibold text-teal-700 bg-teal-100/80 px-1.5 py-0.5 rounded">
                    EMR Quick Record
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Malaria, Headache, Cough (Optional)"
                  value={ailment}
                  onChange={(e) => setAilment(e.target.value)}
                  className="w-full rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {["Malaria", "Headache", "Cough & Catarrh", "Body Pain", "Stomach Ache", "Fever"].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAilment(ailment === preset ? "" : preset)}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        ailment === preset
                          ? "bg-teal-700 text-white border-teal-700 font-bold"
                          : "bg-white text-zinc-600 border-teal-200 hover:bg-teal-50"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                {currentCustomer.name ? (
                  <div className="mt-2 pt-2 border-t border-teal-200/50 flex items-center justify-between text-xs">
                    <span className="text-teal-900 font-medium truncate">
                      Linked: <strong className="text-teal-950">{currentCustomer.name}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentCustomer({ id: null, name: null, encounterId: null })}
                      className="text-red-500 hover:text-red-700 text-[11px] font-semibold shrink-0"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 pt-2 border-t border-teal-200/50 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Customer name (opt.)"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="rounded border border-teal-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-teal-600"
                    />
                    <input
                      type="tel"
                      placeholder="Phone (opt.)"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="rounded border border-teal-200 bg-white px-2 py-1 text-xs text-zinc-900 outline-none focus:border-teal-600"
                    />
                  </div>
                )}
              </div>
              )}

              <button
                onClick={openConfirmModal}
                disabled={submitting || !canCompleteSale}
                className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-3 text-base font-extrabold text-white hover:bg-teal-800 disabled:opacity-60 shadow-md"
              >
                {submitting
                  ? "Processing..."
                  : `Complete Sale — ${cart.reduce((sum, l) => sum + l.quantity, 0)} item${cart.reduce((sum, l) => sum + l.quantity, 0) === 1 ? "" : "s"} · ₦${total.toFixed(2)}`}
              </button>
            </div>
          )}

          {message && (
            <p
              className={`mt-3 shrink-0 text-sm ${message.type === "success" ? "text-teal-700" : "text-red-600"}`}
            >
              {message.text}
            </p>
          )}
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 duration-150">
            <div className={`border-b px-6 py-4 flex items-center justify-between ${effectiveSaleMode === "wholesale" ? "bg-amber-100 border-amber-300" : "bg-zinc-50/80 border-zinc-200"}`}>
              <div>
                <h2 className="text-lg font-bold text-zinc-900">
                  Confirm Sale{effectiveSaleMode === "wholesale" && <span className="ml-2 text-amber-800">— WHOLESALE PRICING</span>}
                </h2>
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
              {(currentCustomer.name || customerName) && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white font-bold text-xs">
                    EMR
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-teal-800 uppercase tracking-wider block">Customer / Patient</span>
                    <span className="text-sm font-bold text-teal-950">{currentCustomer.name || customerName}</span>
                    {customerPhone && <span className="text-xs text-zinc-500 block">{customerPhone}</span>}
                  </div>
                </div>
              )}

              {ailment && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">🩺</span>
                    <div>
                      <span className="text-xs font-semibold text-teal-800 uppercase tracking-wider block">EMR Quick Dispense Condition</span>
                      <span className="text-sm font-bold text-teal-950">{ailment}</span>
                    </div>
                  </div>
                  <span className="text-xs text-teal-700 font-medium bg-teal-100/60 px-2 py-0.5 rounded">Auto-saves to EMR</span>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Items to Purchase ({cart.length})</h3>
                <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                  {cart.map((line) => {
                    if (line.kind === "custom") {
                      const rawTotal = line.unitPrice * line.quantity;
                      const itemTotal = discountedUnitPrice(line.unitPrice, line.discountPercent) * line.quantity;
                      return (
                        <div key={line.key} className="p-3 bg-white flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-zinc-900">
                              {formatProductLabel(line)}{" "}
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Custom</span>
                              {!!line.discountPercent && (
                                <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                  −{line.discountPercent}% OFF
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500">
                              Qty: {line.quantity} × ₦{line.unitPrice.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-right text-sm font-bold">
                            {line.discountPercent ? (
                              <>
                                <span className="block text-xs font-normal text-zinc-400 line-through">₦{rawTotal.toFixed(2)}</span>
                                <span className="text-red-600">₦{itemTotal.toFixed(2)}</span>
                              </>
                            ) : (
                              <span className="text-zinc-900">₦{itemTotal.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const perForm = piecesPerForm(line.product, line.form);
                    const priceForForm = line.customPrice !== undefined ? line.customPrice : unitPriceFor(line.product, effectiveSaleMode) * perForm;
                    const rawTotal = priceForForm * line.quantity;
                    const itemTotal = discountedUnitPrice(priceForForm, line.discountPercent) * line.quantity;
                    return (
                      <div key={line.key} className="p-3 bg-white flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {formatProductLabel(line.product)}
                            {!!line.discountPercent && (
                              <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                −{line.discountPercent}% OFF
                              </span>
                            )}
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
                        <div className="text-right text-sm font-bold">
                          {line.discountPercent ? (
                            <>
                              <span className="block text-xs font-normal text-zinc-400 line-through">₦{rawTotal.toFixed(2)}</span>
                              <span className="text-red-600">₦{itemTotal.toFixed(2)}</span>
                            </>
                          ) : (
                            <span className="text-zinc-900">₦{itemTotal.toFixed(2)}</span>
                          )}
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

      {enlargedImage && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="relative max-h-full max-w-2xl w-full flex flex-col items-center gap-3">
            <button 
              onClick={() => setEnlargedImage(null)}
              className="absolute -top-10 right-0 rounded-full bg-white/20 p-2 text-white hover:bg-white/40"
            >
              ✕
            </button>
            <img 
              src={enlargedImage.url} 
              alt={enlargedImage.name} 
              className="max-h-[80vh] rounded-lg object-contain shadow-2xl" 
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-white font-medium text-lg bg-black/50 px-4 py-1.5 rounded-full backdrop-blur-md">
              {enlargedImage.name}
            </span>
          </div>
        </div>
      )}

      {quickEditProduct && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={closeQuickEdit}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white shadow-2xl overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3">
              <span className="text-sm font-bold text-zinc-800">✏️ Quick Edit</span>
              <button onClick={closeQuickEdit} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none px-1">
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-3">
              <p className="text-xs text-zinc-500 -mt-1">{formatProductLabel(quickEditProduct)}</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Item Name</span>
                  <input
                    type="text"
                    value={quickEditForm.itemName}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, itemName: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Brand</span>
                  <input
                    type="text"
                    value={quickEditForm.brand}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, brand: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Size</span>
                  <input
                    type="text"
                    value={quickEditForm.size}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, size: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Category</span>
                  <select
                    value={quickEditForm.category}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, category: e.target.value as ProductCategory }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  >
                    <option value="medicine">Medicine</option>
                    <option value="non-medicine">Non-medicine</option>
                    <option value="supermarket">Supermarket</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Stock Qty</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickEditForm.quantityInStock}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, quantityInStock: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Cost Price</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickEditForm.costPrice}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, costPrice: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Retail Price</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickEditForm.retailPrice}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, retailPrice: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Wholesale Price</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickEditForm.wholesalePrice}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, wholesalePrice: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Distributor Price</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quickEditForm.distributorPrice}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, distributorPrice: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Batch No.</span>
                  <input
                    type="text"
                    value={quickEditForm.batchNumber}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, batchNumber: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Expiry Date</span>
                  <input
                    type="date"
                    value={quickEditForm.expiryDate}
                    onChange={(e) => setQuickEditForm((f) => ({ ...f, expiryDate: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
              </div>

              {quickEditError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                  ⚠️ {quickEditError}
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-zinc-200 p-3 bg-zinc-50">
              <button
                onClick={closeQuickEdit}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={saveQuickEdit}
                disabled={quickEditSaving}
                className="flex-1 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {quickEditSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {barcodeLinkToast && (
        <div className="fixed top-6 right-6 z-[80] flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white shadow-xl animate-in slide-in-from-top-2">
          <span>✅</span>
          <span>{barcodeLinkToast}</span>
        </div>
      )}
    </div>
  );
}


