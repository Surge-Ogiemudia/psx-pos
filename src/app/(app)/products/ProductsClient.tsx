"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  formatProductLabel,
  type ProductCategory,
  type ProductJSON,
  type ProductRequestJSON,
  type ImportBatchJSON,
  type DeletionLogJSON,
} from "@/lib/types";
import { getExpiryStatus, EXPIRY_ROW_CLASS, EXPIRY_TEXT_CLASS } from "@/lib/expiry";
import { parseNumeric } from "@/lib/numberInput";
import { parseCsv } from "@/lib/csv";
import IncomingBanner from "@/components/IncomingBanner";
import AlertFilterButton from "@/components/AlertFilterButton";
import UnitNameInput from "@/components/UnitNameInput";
import AiProductAssistant from "./AiProductAssistant";
const emptyForm = {
  itemName: "",
  brand: "",
  size: "",
  category: "supermarket" as ProductCategory,
  quantityInStock: "",
  alertQuantity: "",
  retailPrice: "",
  wholesalePrice: "",
  distributorPrice: "",
  costPrice: "",
  batchNumber: "",
  expiryDate: "",
  barcode: "",
  imageUrl: "",
};

interface LevelForm {
  unitName: string;
  unitsPerParent: string;
}

interface SimilarMatch {
  product: ProductJSON;
  score: number;
  exact: boolean;
}

interface BulkReviewRow {
  row: number;
  product: Record<string, unknown>;
  candidate: { _id: string; itemName: string; brand: string; size: string; quantityInStock: number; retailPrice: number };
}

interface BulkDuplicateRow {
  row: number;
  itemName: string;
  brand: string;
  size: string;
}

interface BulkExistingDuplicateRow extends BulkDuplicateRow {
  existing: { _id: string; quantityInStock: number; retailPrice: number };
}

interface BulkFileDuplicateRow extends BulkDuplicateRow {
  firstRow: number;
}

interface BulkRowError {
  row: number;
  type: string;
  error: string;
}

interface BulkAnalysis {
  totalRows: number;
  willAdd: { count: number; byCategory: Record<string, number> };
  existingDuplicates: BulkExistingDuplicateRow[];
  fileDuplicates: BulkFileDuplicateRow[];
  needsReview: BulkReviewRow[];
  errors: BulkRowError[];
}

const CATEGORY_LABELS: Record<string, string> = {
  medicine: "medicine",
  "non-medicine": "non-medicine",
  supermarket: "supermarket",
};

const ERROR_TYPE_LABELS: Record<string, string> = {
  missing_field: "missing a required field",
  invalid_category: "invalid category",
  invalid_price: "invalid price",
  invalid_quantity: "invalid stock quantity",
  invalid_date: "invalid expiry date",
  invalid_hierarchy: "invalid unit hierarchy",
};

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  });
  return Object.entries(counts);
}

const BULK_FIELDS = [
  "itemName",
  "brand",
  "size",
  "category",
  "quantityInStock",
  "retailPrice",
  "wholesalePrice",
  "distributorPrice",
  "costPrice",
  "batchNumber",
  "expiryDate",
  "unitHierarchy",
] as const;

const BULK_TEMPLATE =
  "itemName,brand,size,category,quantityInStock,retailPrice,batchNumber,expiryDate,unitHierarchy\n" +
  "Ibuprofen,GSK,200mg,medicine,50,5.00,IBU-01,2027-01-31,carton:1>box:4>pack:10\n" +
  "Groundnut oil,Mamador,1L,non-medicine,20,3200,,";

export default function ProductsClient({
  isAdmin,
  canEditStock = false,
  branchId,
}: {
  isAdmin: boolean;
  canEditStock?: boolean;
  branchId: string | null;
}) {
  const [products, setProducts] = useState<ProductJSON[]>([]);
  const [search, setSearch] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "expired" | "urgent" | "warning" | "not_expired">(
    "all"
  );
  const [stockFilter, setStockFilter] = useState<"all" | "stockout" | "lastUnit" | "low" | "not_stockout">(
    "all"
  );
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Resets on reload/revisit — a dismissed banner shouldn't stay hidden forever and risk
  // masking a brand-new alert next time something goes wrong.
  const [alertsHidden, setAlertsHidden] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [adjustingProduct, setAdjustingProduct] = useState<ProductJSON | null>(null);
  const [adjustNewQuantity, setAdjustNewQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [adjustingAlertProduct, setAdjustingAlertProduct] = useState<ProductJSON | null>(null);
  const [adjustAlertQuantity, setAdjustAlertQuantity] = useState("");
  const [adjustAlertError, setAdjustAlertError] = useState<string | null>(null);
  const [adjustAlertSubmitting, setAdjustAlertSubmitting] = useState(false);
  const [actionsMenuOpenId, setActionsMenuOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    created: number;
    byCategory: Record<string, number>;
    existingDuplicates: BulkExistingDuplicateRow[];
    fileDuplicates: BulkFileDuplicateRow[];
    errors: BulkRowError[];
  } | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkReview, setBulkReview] = useState<BulkReviewRow[]>([]);
  const [bulkReviewBusyRow, setBulkReviewBusyRow] = useState<number | null>(null);
  const [bulkAnalysis, setBulkAnalysis] = useState<BulkAnalysis | null>(null);
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkExpanded, setBulkExpanded] = useState<Set<string>>(new Set());
  const [bulkFileName, setBulkFileName] = useState("");
  const [importBatches, setImportBatches] = useState<ImportBatchJSON[]>([]);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [unitNameSuggestions, setUnitNameSuggestions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/unit-names")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setUnitNameSuggestions(data.unitNames || []));
  }, []);

  // Collapsed by default — import batches, the deletion log, and the delete-all danger zone
  // are all housekeeping/destructive tools, kept out of the way of day-to-day catalog use.
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [showDeletionLogs, setShowDeletionLogs] = useState(false);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
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
  }, [products]);

  const [deletionLogs, setDeletionLogs] = useState<DeletionLogJSON[]>([]);
  const [expandedDeletionLogs, setExpandedDeletionLogs] = useState<Set<string>>(new Set());

  function toggleDeletionLogExpanded(id: string) {
    setExpandedDeletionLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "Delete all products in the catalog" — the most destructive action on this page, gated
  // behind fetching a fresh count and typing a literal confirmation phrase.
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllCount, setDeleteAllCount] = useState<number | null>(null);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [deleteAllSubmitting, setDeleteAllSubmitting] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);

  function toggleBulkExpanded(key: string) {
    setBulkExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Unit hierarchy builder state for the single-add form
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [levels, setLevels] = useState<LevelForm[]>([
    { unitName: "carton", unitsPerParent: "1" },
    { unitName: "piece", unitsPerParent: "1" },
  ]);

  // Unit hierarchy builder state for inline edit
  const [editHierarchyEnabled, setEditHierarchyEnabled] = useState(false);
  const [editLevels, setEditLevels] = useState<LevelForm[]>([]);

  // "Did you mean" duplicate-check modal for the single-add form
  const [similarMatches, setSimilarMatches] = useState<SimilarMatch[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [resolvingSimilar, setResolvingSimilar] = useState(false);

  // Pending "sold as custom, not in catalog yet" requests filed from POS, awaiting review.
  const [productRequests, setProductRequests] = useState<ProductRequestJSON[]>([]);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [matchingRequestId, setMatchingRequestId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchResults, setMatchResults] = useState<ProductJSON[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [imageUploading, setImageUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/products/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (isEdit) {
        setEditForm((prev) => ({ ...prev, imageUrl: data.url }));
      } else {
        setForm((prev) => ({ ...prev, imageUrl: data.url }));
      }
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setImageUploading(false);
    }
  };

  function addLevel() {
    // Purely sequential: each new field is smaller than the one before it, so it always
    // appends at the bottom — never reorders anything already typed.
    setLevels((prev) => [...prev, { unitName: "", unitsPerParent: "1" }]);
  }

  function removeLevel(index: number) {
    if (levels.length <= 1) return;
    setLevels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLevel(index: number, changes: Partial<LevelForm>) {
    setLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function addEditLevel() {
    setEditLevels((prev) => [...prev, { unitName: "", unitsPerParent: "1" }]);
  }

  function removeEditLevel(index: number) {
    if (editLevels.length <= 1) return;
    setEditLevels((prev) => prev.filter((_, i) => i !== index));
  }

  function updateEditLevel(index: number, changes: Partial<LevelForm>) {
    setEditLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...changes } : l)));
  }

  function buildHierarchy(lvls: LevelForm[]): { unitName: string; unitsPerParent: number }[] {
    return lvls.map((l, i) => ({
      unitName: l.unitName.trim(),
      unitsPerParent: i === 0 ? 1 : Math.max(1, parseNumeric(l.unitsPerParent) || 1),
    }));
  }

  /** How many base (smallest) units make up one of the largest unit. */
  function getBaseUnitsPerLargest(lvls: LevelForm[]): number {
    let result = 1;
    for (let i = 1; i < lvls.length; i++) {
      result *= Math.max(1, parseNumeric(lvls[i].unitsPerParent) || 1);
    }
    return result;
  }

  async function loadProducts() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/products?${params}`);
    if (res.ok) setProducts((await res.json()).products);
  }

  useEffect(() => {
    const timeout = setTimeout(loadProducts, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function loadProductRequests() {
    if (!isAdmin) return;
    const params = new URLSearchParams({ status: "pending" });
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/product-requests?${params}`);
    if (res.ok) setProductRequests((await res.json()).requests);
  }

  useEffect(() => {
    const timeout = setTimeout(loadProductRequests, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, branchId]);

  async function loadImportBatches() {
    if (!isAdmin) return;
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/import-batches?${params}`);
    if (res.ok) setImportBatches((await res.json()).batches);
  }

  useEffect(() => {
    const timeout = setTimeout(loadImportBatches, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, branchId]);

  async function loadDeletionLogs() {
    if (!isAdmin) return;
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/deletion-logs?${params}`);
    if (res.ok) setDeletionLogs((await res.json()).logs);
  }

  useEffect(() => {
    const timeout = setTimeout(loadDeletionLogs, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, branchId]);

  async function deleteImportBatch(batch: ImportBatchJSON) {
    if (
      !confirm(
        `Delete this batch? This removes all ${batch.remainingCount} item${batch.remainingCount === 1 ? "" : "s"} it added to the catalog.`
      )
    ) {
      return;
    }
    setDeletingBatchId(batch._id);
    try {
      const params = branchId ? `?branchId=${branchId}` : "";
      const res = await fetch(`/api/import-batches/${batch._id}${params}`, { method: "DELETE" });
      if (res.ok) {
        setImportBatches((prev) => prev.filter((b) => b._id !== batch._id));
        loadProducts();
        loadDeletionLogs();
      } else {
        const data = await res.json();
        setBulkError(data.error || "Failed to delete batch");
      }
    } finally {
      setDeletingBatchId(null);
    }
  }

  useEffect(() => {
    if (!matchingRequestId || !matchSearch.trim()) {
      const timeout = setTimeout(() => setMatchResults([]), 0);
      return () => clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      const params = new URLSearchParams({ search: matchSearch.trim() });
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
      if (res.ok) setMatchResults((await res.json()).products.slice(0, 8));
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [matchingRequestId, matchSearch, branchId]);

  function approveRequest(request: ProductRequestJSON) {
    setRequestError(null);
    setApprovingRequestId(request._id);
    setShowForm(true);
    setBulkMode(false);
    setForm({
      ...emptyForm,
      itemName: request.itemName,
      brand: request.brand,
      size: request.size,
      category: request.category,
      retailPrice: String(request.requestedPrice),
    });
  }

  async function linkRequestToProduct(requestId: string, productId: string, action: "resolve_duplicate" | "approve") {
    setRequestError(null);
    const res = await fetch(`/api/product-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, productId, branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRequestError(data.error || "Failed to update request");
      return;
    }
    setMatchingRequestId(null);
    setMatchSearch("");
    setMatchResults([]);
    loadProductRequests();
  }

  async function rejectRequest(requestId: string) {
    if (!confirm("Reject this request? No product will be created or adjusted.")) return;
    setRequestError(null);
    const res = await fetch(`/api/product-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", branchId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRequestError(data.error || "Failed to reject request");
      return;
    }
    loadProductRequests();
  }

  async function createProduct() {
    setError(null);
    if (!form.itemName.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!form.brand.trim()) {
      setError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
      return;
    }
    if (!form.size.trim()) {
      setError('Size is required — use "Standard" if the item has no size/strength variation.');
      return;
    }
    const payload: Record<string, unknown> = { ...form, branchId };
    if (hierarchyEnabled && levels.length > 0) {
      const hierarchy = buildHierarchy(levels);
      if (hierarchy.some((l) => !l.unitName)) {
        setError("Every unit level needs a name.");
        return;
      }
      payload.unitHierarchy = hierarchy;
      // Prices are entered as per-largest-unit; convert to per-base-unit for storage.
      const divisor = getBaseUnitsPerLargest(levels);
      if (payload.retailPrice) payload.retailPrice = parseNumeric(payload.retailPrice) / divisor;
      if (payload.wholesalePrice) payload.wholesalePrice = parseNumeric(payload.wholesalePrice) / divisor;
      if (payload.distributorPrice) payload.distributorPrice = parseNumeric(payload.distributorPrice) / divisor;
      if (payload.costPrice) payload.costPrice = parseNumeric(payload.costPrice) / divisor;
    }

    // Central catalog: check for an exact or near-name match before creating a second row.
    const params = new URLSearchParams({ itemName: form.itemName, brand: form.brand, size: form.size });
    if (branchId) params.set("branchId", branchId);
    const simRes = await fetch(`/api/products/similar?${params}`);
    if (simRes.ok) {
      const simData = await simRes.json();
      if (simData.matches && simData.matches.length > 0) {
        setSimilarMatches(simData.matches);
        setPendingPayload(payload);
        return;
      }
    }
    await submitCreate(payload);
  }

  async function submitCreate(payload: Record<string, unknown>) {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create product");
      return;
    }
    if (approvingRequestId) {
      await linkRequestToProduct(approvingRequestId, data.product._id, "approve");
      setApprovingRequestId(null);
    }
    setForm(emptyForm);
    setShowForm(false);
    setHierarchyEnabled(false);
    setLevels([
      { unitName: "carton", unitsPerParent: "1" },
      { unitName: "piece", unitsPerParent: "1" },
    ]);
    loadProducts();
  }

  async function resolveSimilar(choice: "new" | "batch" | "merge") {
    if (!pendingPayload) return;
    setResolvingSimilar(true);
    setError(null);
    try {
      if (choice === "new") {
        await submitCreate(pendingPayload);
      } else {
        const target = similarMatches?.[0]?.product;
        if (!target) return;
        const res = await fetch(`/api/products/${target._id}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: choice, ...pendingPayload }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to merge product");
          return;
        }
        setForm(emptyForm);
        setShowForm(false);
        setHierarchyEnabled(false);
        setLevels([
          { unitName: "carton", unitsPerParent: "1" },
          { unitName: "piece", unitsPerParent: "1" },
        ]);
        loadProducts();
      }
    } finally {
      setResolvingSimilar(false);
      setSimilarMatches(null);
      setPendingPayload(null);
      // If approving a product request led here via "batch"/"merge" instead of "new", the
      // request itself is left pending rather than guessing how to reconcile it — the merge
      // already adjusted stock its own way, so admin can match the request to it manually.
      setApprovingRequestId(null);
    }
  }

  function startEdit(product: ProductJSON) {
    setEditingId(product._id);
    if (product.unitHierarchy && product.unitHierarchy.length > 0) {
      setEditHierarchyEnabled(true);
      const editLvls = product.unitHierarchy.map((l) => ({
        unitName: l.unitName,
        unitsPerParent: String(l.unitsPerParent),
      }));
      setEditLevels(editLvls);
      // Convert stored per-base-unit prices back to per-largest-unit for display.
      const multiplier = getBaseUnitsPerLargest(editLvls);
      setEditForm({
        itemName: product.itemName,
        brand: product.brand,
        size: product.size,
        category: product.category,
        quantityInStock: Math.round((product.quantityInStock / (multiplier || 1)) * 100) / 100,
        retailPrice: Math.round(product.retailPrice * multiplier * 100) / 100,
        wholesalePrice: Math.round(product.wholesalePrice * multiplier * 100) / 100,
        distributorPrice: Math.round(product.distributorPrice * multiplier * 100) / 100,
        costPrice: Math.round((product.costPrice || 0) * multiplier * 100) / 100,
        batchNumber: product.batchNumber || "",
        expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
        barcode: product.barcode || "",
      });
    } else {
      setEditHierarchyEnabled(false);
      setEditLevels([
        { unitName: "carton", unitsPerParent: "1" },
        { unitName: "piece", unitsPerParent: "1" },
      ]);
      setEditForm({
        itemName: product.itemName,
        brand: product.brand,
        size: product.size,
        category: product.category,
        quantityInStock: product.quantityInStock,
        retailPrice: product.retailPrice,
        wholesalePrice: product.wholesalePrice,
        distributorPrice: product.distributorPrice,
        costPrice: product.costPrice || 0,
        batchNumber: product.batchNumber || "",
        expiryDate: product.expiryDate ? product.expiryDate.slice(0, 10) : "",
        barcode: product.barcode || "",
      });
    }
  }

  async function saveEdit(id: string) {
    setError(null);
    if (!String(editForm.itemName || "").trim()) {
      setError("Item name is required.");
      return;
    }
    if (!String(editForm.brand || "").trim()) {
      setError("Brand is required — if it's not printed on the packaging, look up the manufacturer.");
      return;
    }
    if (!String(editForm.size || "").trim()) {
      setError('Size is required — use "Standard" if the item has no size/strength variation.');
      return;
    }
    const payload: Record<string, unknown> = { ...editForm, branchId };
    if (editHierarchyEnabled && editLevels.length > 0) {
      const hierarchy = buildHierarchy(editLevels);
      if (hierarchy.some((l) => !l.unitName)) {
        setError("Every unit level needs a name.");
        return;
      }
      payload.unitHierarchy = hierarchy;
      // Prices are displayed as per-largest-unit; convert to per-base-unit for storage.
      const divisor = getBaseUnitsPerLargest(editLevels);
      if (payload.retailPrice) payload.retailPrice = parseNumeric(payload.retailPrice) / divisor;
      if (payload.wholesalePrice) payload.wholesalePrice = parseNumeric(payload.wholesalePrice) / divisor;
      if (payload.distributorPrice) payload.distributorPrice = parseNumeric(payload.distributorPrice) / divisor;
      if (payload.costPrice) payload.costPrice = parseNumeric(payload.costPrice) / divisor;
      if (payload.quantityInStock !== undefined && payload.quantityInStock !== "") {
        payload.quantityInStock = Math.round(parseNumeric(payload.quantityInStock) * divisor);
      }
    } else {
      // Clear hierarchy if user toggled it off
      payload.unitHierarchy = null;
      if (payload.quantityInStock !== undefined && payload.quantityInStock !== "") {
        payload.quantityInStock = parseNumeric(payload.quantityInStock);
      }
    }
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to update product");
      return;
    }
    setEditingId(null);
    loadProducts();
  }

  function openAdjustStock(product: ProductJSON) {
    setAdjustingProduct(product);
    setAdjustNewQuantity(String(product.quantityInStock));
    setAdjustReason("");
    setAdjustError(null);
  }

  async function submitAdjustStock() {
    if (!adjustingProduct) return;
    setAdjustError(null);
    const newQuantity = parseNumeric(adjustNewQuantity);
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      setAdjustError("Enter a non-negative number.");
      return;
    }
    if (!adjustReason.trim()) {
      setAdjustError("A reason is required.");
      return;
    }
    setAdjustSubmitting(true);
    try {
      const res = await fetch(`/api/products/${adjustingProduct._id}/adjust-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newQuantity, reason: adjustReason.trim(), branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdjustError(data.error || "Failed to adjust stock");
        return;
      }
      setAdjustingProduct(null);
      loadProducts();
    } finally {
      setAdjustSubmitting(false);
    }
  }

  function openAdjustAlertQty(product: ProductJSON) {
    setAdjustingAlertProduct(product);
    setAdjustAlertQuantity(String(product.alertQuantity));
    setAdjustAlertError(null);
  }

  async function submitAdjustAlertQty() {
    if (!adjustingAlertProduct) return;
    setAdjustAlertError(null);
    const newAlertQuantity = parseNumeric(adjustAlertQuantity);
    if (!Number.isFinite(newAlertQuantity) || newAlertQuantity < 0) {
      setAdjustAlertError("Enter a non-negative number.");
      return;
    }
    setAdjustAlertSubmitting(true);
    try {
      const res = await fetch(`/api/products/${adjustingAlertProduct._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertQuantity: newAlertQuantity, branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdjustAlertError(data.error || "Failed to update alert quantity");
        return;
      }
      setAdjustingAlertProduct(null);
      loadProducts();
    } finally {
      setAdjustAlertSubmitting(false);
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm("Delete this product?")) return;
    const params = branchId ? `?branchId=${branchId}` : "";
    const res = await fetch(`/api/products/${id}${params}`, { method: "DELETE" });
    if (res.ok) {
      loadProducts();
      loadDeletionLogs();
    }
  }

  async function openDeleteAllConfirm() {
    setDeleteAllError(null);
    setDeleteAllConfirmText("");
    setDeleteAllCount(null);
    setDeleteAllOpen(true);
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    const res = await fetch(`/api/products?${params}`);
    if (res.ok) {
      setDeleteAllCount((await res.json()).products.length);
    } else {
      setDeleteAllError("Couldn't load the current catalog count — try again.");
    }
  }

  async function confirmDeleteAll() {
    if (deleteAllCount === null || deleteAllConfirmText !== "DELETE") return;
    setDeleteAllSubmitting(true);
    setDeleteAllError(null);
    try {
      const params = new URLSearchParams({ expectedCount: String(deleteAllCount) });
      if (branchId) params.set("branchId", branchId);
      const res = await fetch(`/api/products?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteAllError(data.error || "Failed to delete the catalog");
        setDeleteAllCount(typeof data.actualCount === "number" ? data.actualCount : deleteAllCount);
        setDeleteAllConfirmText("");
        return;
      }
      setDeleteAllOpen(false);
      setImportBatches([]);
      loadProducts();
      loadDeletionLogs();
    } finally {
      setDeleteAllSubmitting(false);
    }
  }

  function updateBulkText(text: string) {
    setBulkText(text);
    setBulkFileName("");
    setBulkAnalysis(null);
    setBulkExpanded(new Set());
    setBulkError(null);
    setBulkResult(null);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setBulkError(null);
    setBulkResult(null);
    setBulkAnalysis(null);
    setBulkExpanded(new Set());
    setBulkFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name);

    try {
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        setBulkText(XLSX.utils.sheet_to_csv(firstSheet));
      } else {
        setBulkText(await file.text());
      }
    } catch {
      setBulkError("Couldn't read that file — make sure it's a valid CSV or Excel (.xlsx) file.");
    }
  }

  function buildBulkProducts(): { products: Record<string, string>[]; error?: string } {
    const { rows, error: parseError } = parseCsv(bulkText);
    if (parseError) return { products: [], error: parseError };
    const products = rows.map((row) => {
      const product: Record<string, string> = {};
      BULK_FIELDS.forEach((field) => {
        product[field] = row[field.toLowerCase()] ?? "";
      });
      return product;
    });
    return { products };
  }

  async function analyzeBulk() {
    setBulkError(null);
    setBulkResult(null);
    setBulkAnalysis(null);
    setBulkExpanded(new Set());

    const { products, error: parseError } = buildBulkProducts();
    if (parseError) {
      setBulkError(parseError);
      return;
    }

    setBulkAnalyzing(true);
    try {
      const res = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products, branchId, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBulkError(data.error || "Couldn't analyze that file");
        return;
      }
      setBulkAnalysis(data);
    } finally {
      setBulkAnalyzing(false);
    }
  }

  async function importBulk() {
    setBulkError(null);
    setBulkResult(null);

    const { products, error: parseError } = buildBulkProducts();
    if (parseError) {
      setBulkError(parseError);
      return;
    }

    setBulkSubmitting(true);
    const res = await fetch("/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products, branchId, fileName: bulkFileName }),
    });
    const data = await res.json();
    setBulkSubmitting(false);

    if (!res.ok && !data.created && !(data.needsReview || []).length) {
      setBulkError(data.error || "Import failed");
      return;
    }

    setBulkResult({
      created: data.created,
      byCategory: data.byCategory || {},
      existingDuplicates: data.existingDuplicates || [],
      fileDuplicates: data.fileDuplicates || [],
      errors: data.errors || [],
    });
    setBulkReview(data.needsReview || []);
    setBulkAnalysis(null);
    setBulkExpanded(new Set());
    const nothingLeftToFix =
      (data.errors || []).length === 0 &&
      (data.existingDuplicates || []).length === 0 &&
      (data.fileDuplicates || []).length === 0 &&
      !(data.needsReview || []).length;
    if (nothingLeftToFix) {
      setBulkText("");
      setBulkFileName("");
    }
    loadProducts();
    loadImportBatches();
  }

  async function resolveBulkReviewRow(reviewRow: BulkReviewRow, choice: "new" | "batch" | "merge") {
    setBulkReviewBusyRow(reviewRow.row);
    try {
      const res =
        choice === "new"
          ? await fetch("/api/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(reviewRow.product),
            })
          : await fetch(`/api/products/${reviewRow.candidate._id}/merge`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mode: choice, ...reviewRow.product }),
            });
      if (res.ok) {
        setBulkReview((prev) => prev.filter((r) => r.row !== reviewRow.row));
        loadProducts();
      } else {
        const data = await res.json();
        setBulkError(data.error || "Failed to resolve row");
      }
    } finally {
      setBulkReviewBusyRow(null);
    }
  }

  const visibleProducts = products.filter((p) => {
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (expiryFilter !== "all") {
      const level = getExpiryStatus(p.expiryDate).level;
      if (expiryFilter === "not_expired" ? level === "expired" : level !== expiryFilter) return false;
    }
    if (stockFilter !== "all") {
      if (stockFilter === "not_stockout" && p.quantityInStock <= 0) return false;
      if (stockFilter === "stockout" && p.quantityInStock > 0) return false;
      if (stockFilter === "lastUnit" && p.quantityInStock !== 1) return false;
      if (stockFilter === "low" && !(p.quantityInStock > 1 && p.quantityInStock <= p.alertQuantity)) return false;
    }
    return true;
  });

  const activeFilterCount =
    (categoryFilter !== "all" ? 1 : 0) + (expiryFilter !== "all" ? 1 : 0) + (stockFilter !== "all" ? 1 : 0);

  const expiredProducts = products.filter((p) => getExpiryStatus(p.expiryDate).level === "expired");
  const urgentProducts = products.filter((p) => getExpiryStatus(p.expiryDate).level === "urgent");
  const warningProducts = products.filter((p) => getExpiryStatus(p.expiryDate).level === "warning");
  const stockoutProducts = products.filter((p) => p.quantityInStock <= 0);
  // Last unit is always worth flagging regardless of the product's own alert threshold — e.g.
  // anything that started at 0 stock defaults to a 0 threshold and would otherwise never get
  // caught until it's a full stockout.
  const lastUnitProducts = products.filter((p) => p.quantityInStock === 1);
  const lowStockProducts = products.filter(
    (p) => p.quantityInStock > 1 && p.quantityInStock <= p.alertQuantity
  );
  const totalAlertCount =
    expiredProducts.length +
    urgentProducts.length +
    warningProducts.length +
    stockoutProducts.length +
    lastUnitProducts.length +
    lowStockProducts.length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Product catalog</h1>
        <div className="flex items-center gap-0">
          <IncomingBanner scope="branch" scopeId={branchId} />
          {isAdmin && (
            <div className="relative">
              {showForm || bulkMode ? (
                <button
                  onClick={() => {
                    setShowForm(false);
                    setBulkMode(false);
                    setApprovingRequestId(null);
                  }}
                  className="flex w-14 flex-col items-center gap-1"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-200 text-zinc-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path
                        fillRule="evenodd"
                        d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <span className="text-center text-[10px] font-medium text-zinc-600">Cancel</span>
                </button>
              ) : (
                <button onClick={() => setAddMenuOpen((v) => !v)} className="flex w-14 flex-col items-center gap-1">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
                    </svg>
                  </span>
                  <span className="text-center text-[10px] font-medium text-zinc-600">Add</span>
                </button>
              )}
              {addMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                  <button
                    onClick={() => {
                      setShowForm(true);
                      setBulkMode(false);
                      setApprovingRequestId(null);
                      setForm(emptyForm);
                      setAddMenuOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                  >
                    Single item
                  </button>
                  <button
                    onClick={() => {
                      setBulkMode(true);
                      setShowForm(false);
                      setAddMenuOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                  >
                    Bulk import
                  </button>
                  <button
                    onClick={() => {
                      setShowAiAssistant(true);
                      setAddMenuOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-teal-50 text-teal-700 font-medium border-t border-zinc-100"
                  >
                    ✨ AI Add Product
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isAdmin && productRequests.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-amber-900">
            Pending item requests ({productRequests.length})
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Sold at POS as a custom item because it wasn&apos;t in the catalog. Add it as a new product, or match
            it to an existing product to reconcile the stock that already left the shelf.
          </p>
          {requestError && <p className="mb-2 text-sm text-red-600">{requestError}</p>}
          <div className="flex flex-col gap-3">
            {productRequests.map((req) => (
              <div key={req._id} className="rounded border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-zinc-900">
                      {formatProductLabel(req)} <span className="text-zinc-400">({req.category})</span>
                    </span>
                    <p className="text-xs text-zinc-500">
                      Sold {req.quantitySold} at ₦{req.requestedPrice.toFixed(2)} each by {req.requestedByName} on{" "}
                      {new Date(req.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveRequest(req)}
                      className="rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    >
                      Add as new product
                    </button>
                    <button
                      onClick={() => {
                        setMatchingRequestId(matchingRequestId === req._id ? null : req._id);
                        setMatchSearch("");
                        setMatchResults([]);
                      }}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Match existing product
                    </button>
                    <button
                      onClick={() => rejectRequest(req._id)}
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {matchingRequestId === req._id && (
                  <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2">
                    <input
                      placeholder="Search existing products..."
                      value={matchSearch}
                      onChange={(e) => setMatchSearch(e.target.value)}
                      className="mb-2 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-col gap-1">
                      {matchResults.map((product) => (
                        <button
                          key={product._id}
                          onClick={() => linkRequestToProduct(req._id, product._id, "resolve_duplicate")}
                          className="rounded px-2 py-1 text-left text-sm text-teal-700 hover:bg-teal-100"
                        >
                          {formatProductLabel(product)} — Stock: {product.quantityInStock}
                        </button>
                      ))}
                      {matchSearch.trim() && matchResults.length === 0 && (
                        <p className="px-2 py-1 text-xs text-zinc-500">No matches.</p>
                      )}
                    </div>
                    <p className="mt-1 px-2 text-xs text-zinc-500">
                      Selecting a product deducts {req.quantitySold} from its stock, reconciling the sale.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
        <div className="relative shrink-0">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-6.757a2.25 2.25 0 00-.659-1.591L2.659 5.22A2.25 2.25 0 012 3.629V1.34a.75.75 0 01.628-.74z"
                clipRule="evenodd"
              />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-1 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filtersOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
              <div className="flex flex-col gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as ProductCategory | "all")}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">All categories</option>
                  <option value="medicine">Medicine</option>
                  <option value="non-medicine">Non-medicine</option>
                  <option value="supermarket">Supermarket</option>
                </select>
                <select
                  value={expiryFilter}
                  onChange={(e) => setExpiryFilter(e.target.value as typeof expiryFilter)}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">Any expiry</option>
                  <option value="expired">Expired</option>
                  <option value="urgent">Expiring within 30 days</option>
                  <option value="warning">Expiring within 90 days</option>
                  <option value="not_expired">Not expired</option>
                </select>
                <select
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="all">Any stock level</option>
                  <option value="stockout">Stockout</option>
                  <option value="lastUnit">Only 1 left</option>
                  <option value="low">Below alert threshold</option>
                  <option value="not_stockout">Not stockout</option>
                </select>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setCategoryFilter("all");
                      setExpiryFilter("all");
                      setStockFilter("all");
                    }}
                    className="text-left text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {totalAlertCount > 0 && (
        <div className="mb-1 flex justify-end">
          <button
            onClick={() => setAlertsHidden((v) => !v)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 hover:underline"
          >
            {alertsHidden ? `Show alerts (${totalAlertCount})` : "Hide alerts"}
          </button>
        </div>
      )}

      {!alertsHidden && expiredProducts.length + urgentProducts.length + warningProducts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center">
          <span className="text-xs font-medium text-zinc-500">Expiry:</span>
          <div className="flex flex-wrap gap-2">
            {expiredProducts.length > 0 && (
              <AlertFilterButton
                count={expiredProducts.length}
                label="expired"
                severity="high"
                active={expiryFilter === "expired"}
                onClick={() => setExpiryFilter((prev) => (prev === "expired" ? "all" : "expired"))}
              />
            )}
            {urgentProducts.length > 0 && (
              <AlertFilterButton
                count={urgentProducts.length}
                label="expiring within 30 days"
                severity="medium"
                active={expiryFilter === "urgent"}
                onClick={() => setExpiryFilter((prev) => (prev === "urgent" ? "all" : "urgent"))}
              />
            )}
            {warningProducts.length > 0 && (
              <AlertFilterButton
                count={warningProducts.length}
                label="expiring within 90 days"
                severity="low"
                active={expiryFilter === "warning"}
                onClick={() => setExpiryFilter((prev) => (prev === "warning" ? "all" : "warning"))}
              />
            )}
            {expiryFilter !== "all" && (
              <button
                onClick={() => setExpiryFilter("all")}
                className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {!alertsHidden && stockoutProducts.length + lastUnitProducts.length + lowStockProducts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center">
          <span className="text-xs font-medium text-zinc-500">Stock:</span>
          <div className="flex flex-wrap gap-2">
            {stockoutProducts.length > 0 && (
              <AlertFilterButton
                count={stockoutProducts.length}
                label="stockout"
                severity="high"
                active={stockFilter === "stockout"}
                onClick={() => setStockFilter((prev) => (prev === "stockout" ? "all" : "stockout"))}
              />
            )}
            {lastUnitProducts.length > 0 && (
              <AlertFilterButton
                count={lastUnitProducts.length}
                label={`item${lastUnitProducts.length === 1 ? "" : "s"} with only 1 left`}
                severity="medium"
                active={stockFilter === "lastUnit"}
                onClick={() => setStockFilter((prev) => (prev === "lastUnit" ? "all" : "lastUnit"))}
              />
            )}
            {lowStockProducts.length > 0 && (
              <AlertFilterButton
                count={lowStockProducts.length}
                label="below alert threshold"
                severity="low"
                active={stockFilter === "low"}
                onClick={() => setStockFilter((prev) => (prev === "low" ? "all" : "low"))}
              />
            )}
            {stockFilter !== "all" && (
              <button
                onClick={() => setStockFilter("all")}
                className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {similarMatches && similarMatches.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h2 className="mb-2 text-base font-semibold text-zinc-900">Is this the same product?</h2>
            <p className="mb-3 text-sm text-zinc-600">
              You&apos;re adding <strong>{form.itemName} · {form.brand} · {form.size}</strong>. A very similar
              product is already in the catalog:
            </p>
            <div className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <p className="font-medium text-zinc-900">
                {similarMatches[0].product.itemName} · {similarMatches[0].product.brand} · {similarMatches[0].product.size}
              </p>
              <p className="mt-1 text-zinc-600">
                Stock: {similarMatches[0].product.quantityInStock} · Retail: ₦{similarMatches[0].product.retailPrice.toFixed(2)}
                {similarMatches[0].product.expiryDate && <> · Expiry: {similarMatches[0].product.expiryDate.slice(0, 10)}</>}
              </p>
              {similarMatches.length > 1 && (
                <p className="mt-1 text-xs text-zinc-500">+{similarMatches.length - 1} other similar match(es) not shown.</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                disabled={resolvingSimilar}
                onClick={() => resolveSimilar("new")}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                No — different product, add separately
              </button>
              <button
                disabled={resolvingSimilar}
                onClick={() => resolveSimilar("batch")}
                className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
              >
                Yes — new batch (combine stock, keep soonest expiry)
              </button>
              <button
                disabled={resolvingSimilar}
                onClick={() => resolveSimilar("merge")}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                Yes — merge completely (soonest expiry, highest price)
              </button>
              <button
                disabled={resolvingSimilar}
                onClick={() => {
                  setSimilarMatches(null);
                  setPendingPayload(null);
                }}
                className="text-xs text-zinc-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && showForm && (
        <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <input
            placeholder="Item name (e.g. Amlodipine)"
            value={form.itemName}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Brand / manufacturer"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder='Size / strength (e.g. 5mg, 1L, "Standard")'
            value={form.size}
            onChange={(e) => setForm({ ...form, size: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as ProductCategory })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="supermarket">Supermarket</option>
            <option value="medicine">Medicine</option>
            <option value="non-medicine">Non-medicine</option>
          </select>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Stock qty"
            value={form.quantityInStock}
            onChange={(e) => setForm({ ...form, quantityInStock: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="Alert quantity (optional — defaults to 20% of stock)"
            value={form.alertQuantity}
            onChange={(e) => setForm({ ...form, alertQuantity: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <div className="flex flex-col">
            <input
              type="text"
              inputMode="decimal"
              placeholder="CostPrice"
              value={form.costPrice}
              onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
              className="rounded border border-zinc-300 bg-orange-50/50 px-2 py-1.5 text-sm"
            />
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Retail price"
            value={form.retailPrice}
            onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Wholesale price (optional)"
            value={form.wholesalePrice}
            onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <div className="flex flex-col">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Distributor price"
              value={form.distributorPrice}
              onChange={(e) => setForm({ ...form, distributorPrice: e.target.value })}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <input
            placeholder="Batch number (optional)"
            value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            placeholder="Expiry date (optional)"
            value={form.expiryDate}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Barcode / UPC (scan here)"
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Product Image (optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleImageUpload(e, false)}
              className="text-sm file:mr-4 file:rounded-full file:border-0 file:bg-blue-50 file:px-4 file:py-1 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
            />
            {imageUploading && <span className="text-xs text-blue-600">Uploading...</span>}
            {form.imageUrl && (
              <img src={form.imageUrl} alt="Preview" className="mt-2 h-16 w-16 rounded object-cover" />
            )}
          </div>

          {/* Unit hierarchy (packaging form) builder */}
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={hierarchyEnabled}
                onChange={(e) => setHierarchyEnabled(e.target.checked)}
                className="rounded border-zinc-300"
              />
              Define packaging forms (e.g. carton → box → piece)
            </label>
            {hierarchyEnabled && (
              <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-2 text-xs text-zinc-500">
                  Largest unit first, smallest (base) unit last. POS will let staff sell in any of these forms.
                </p>
                {levels.length >= 2 && levels[0].unitName && levels[levels.length - 1].unitName && (
                  <p className="mb-2 rounded bg-teal-50 px-2 py-1 text-xs text-teal-700">
                    💡 Prices above are per <strong>{levels[0].unitName}</strong>. Stock qty is in{" "}
                    <strong>{levels[levels.length - 1].unitName}s</strong> (smallest unit).
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {levels.map((level, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {i > 0 && (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={level.unitsPerParent}
                          onChange={(e) => updateLevel(i, { unitsPerParent: e.target.value })}
                          className="w-16 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                        />
                      )}
                      <div className="flex-1">
                        <UnitNameInput
                          value={level.unitName}
                          onChange={(v) => updateLevel(i, { unitName: v })}
                          suggestions={unitNameSuggestions}
                          placeholder={i === 0 ? "e.g. carton" : i === levels.length - 1 ? "e.g. piece" : "e.g. box"}
                          className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      {i > 0 && (
                        <>
                          <span className="text-xs text-zinc-500">per</span>
                          <span className="text-xs text-zinc-500">{levels[i - 1].unitName || "unit"}</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLevel(i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addLevel}
                  className="mt-2 text-sm text-teal-700 hover:underline"
                >
                  + Add unit level
                </button>
              </div>
            )}
          </div>

          <button
            onClick={createProduct}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 sm:col-span-2 lg:col-span-4"
          >
            Save product
          </button>
        </div>
      )}

      {isAdmin && bulkMode && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm text-zinc-600">
            Paste CSV with a header row:{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
              itemName,brand,size,category,quantityInStock,retailPrice,batchNumber,expiryDate,unitHierarchy
            </code>
            . <strong>itemName, brand, size, and retailPrice are all required for every row</strong> — brand
            is the manufacturer (look it up if it isn&apos;t printed on the packaging), size is the
            strength/measurement (use &quot;Standard&quot; if the item has no size variation). Category must
            be &quot;supermarket&quot;, &quot;medicine&quot;, or &quot;non-medicine&quot; — defaults to
            &quot;supermarket&quot; if left blank. wholesalePrice/distributorPrice (optional extra columns)
            default to retailPrice, and batchNumber/expiryDate (YYYY-MM-DD) are optional. unitHierarchy uses
            the format{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
              carton:1&gt;box:4&gt;piece:10
            </code>{" "}
            (largest to smallest, with units-per-parent after the colon) — leave blank if not needed.
          </p>
          <p className="mb-2 text-sm text-zinc-600">
            Click <strong>Check file</strong> first — it analyzes every row without adding anything, and shows
            how many will be added (by category), how many are duplicates of items already in the system, how
            many are duplicated within the file itself, and how many have errors, each with a breakdown you can
            click to view. Fix the file and re-check, or add the valid rows now and leave the rest out.
          </p>
          <div className="mb-3 flex items-center gap-3">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileSelected}
              className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-50"
            />
            <span className="text-xs text-zinc-400">or paste CSV directly below</span>
          </div>
          <textarea
            value={bulkText}
            onChange={(e) => updateBulkText(e.target.value)}
            rows={8}
            placeholder={BULK_TEMPLATE}
            className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          {bulkError && <p className="mb-2 text-sm text-red-600">{bulkError}</p>}

          {bulkAnalysis && (
            <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="mb-2 text-sm font-medium text-zinc-800">
                Checked {bulkAnalysis.totalRows} row{bulkAnalysis.totalRows === 1 ? "" : "s"} — here&apos;s what
                will happen if you proceed:
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                <li className="rounded border border-teal-200 bg-teal-50 p-2 text-teal-800">
                  <strong>{bulkAnalysis.willAdd.count}</strong> item{bulkAnalysis.willAdd.count === 1 ? "" : "s"}{" "}
                  will be added successfully
                  {bulkAnalysis.willAdd.count > 0 && (
                    <>
                      {" "}
                      (
                      {Object.entries(bulkAnalysis.willAdd.byCategory)
                        .filter(([, n]) => n > 0)
                        .map(([cat, n]) => `${n} ${CATEGORY_LABELS[cat] ?? cat}`)
                        .join(", ")}
                      )
                    </>
                  )}
                  .
                </li>

                {bulkAnalysis.existingDuplicates.length > 0 && (
                  <li className="rounded border border-amber-200 bg-amber-50 p-2">
                    <button
                      onClick={() => toggleBulkExpanded("existing")}
                      className="text-left text-amber-800 hover:underline"
                    >
                      <strong>{bulkAnalysis.existingDuplicates.length}</strong> already exist
                      {bulkAnalysis.existingDuplicates.length === 1 ? "s" : ""} in the system as an exact match —
                      won&apos;t be added ({bulkExpanded.has("existing") ? "hide" : "click to view"})
                    </button>
                    {bulkExpanded.has("existing") && (
                      <ul className="mt-2 list-disc pl-5 text-zinc-700">
                        {bulkAnalysis.existingDuplicates.map((d) => (
                          <li key={d.row}>
                            Row {d.row}: {d.itemName} · {d.brand} · {d.size} — already in stock (
                            {d.existing.quantityInStock} units, ₦{d.existing.retailPrice.toFixed(2)}). Use
                            &quot;Add product&quot; to merge stock into it instead.
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )}

                {bulkAnalysis.fileDuplicates.length > 0 && (
                  <li className="rounded border border-amber-200 bg-amber-50 p-2">
                    <button
                      onClick={() => toggleBulkExpanded("file")}
                      className="text-left text-amber-800 hover:underline"
                    >
                      <strong>{bulkAnalysis.fileDuplicates.length}</strong> duplicated within this file — only the
                      first occurrence will be added ({bulkExpanded.has("file") ? "hide" : "click to view"})
                    </button>
                    {bulkExpanded.has("file") && (
                      <ul className="mt-2 list-disc pl-5 text-zinc-700">
                        {bulkAnalysis.fileDuplicates.map((d) => (
                          <li key={d.row}>
                            Row {d.row}: {d.itemName} · {d.brand} · {d.size} — same as row {d.firstRow}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )}

                {bulkAnalysis.needsReview.length > 0 && (
                  <li className="rounded border border-amber-200 bg-amber-50 p-2">
                    <button
                      onClick={() => toggleBulkExpanded("fuzzy")}
                      className="text-left text-amber-800 hover:underline"
                    >
                      <strong>{bulkAnalysis.needsReview.length}</strong> look similar to an existing product —
                      you&apos;ll be asked to resolve each one after you proceed (
                      {bulkExpanded.has("fuzzy") ? "hide" : "click to view"})
                    </button>
                    {bulkExpanded.has("fuzzy") && (
                      <ul className="mt-2 list-disc pl-5 text-zinc-700">
                        {bulkAnalysis.needsReview.map((r) => (
                          <li key={r.row}>
                            Row {r.row}: {String(r.product.itemName)} · {String(r.product.brand)} ·{" "}
                            {String(r.product.size)} — similar to {r.candidate.itemName} · {r.candidate.brand} ·{" "}
                            {r.candidate.size}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )}

                {bulkAnalysis.errors.length > 0 && (
                  <li className="rounded border border-red-200 bg-red-50 p-2">
                    <button
                      onClick={() => toggleBulkExpanded("errors")}
                      className="text-left text-red-800 hover:underline"
                    >
                      <strong>{bulkAnalysis.errors.length}</strong> row{bulkAnalysis.errors.length === 1 ? "" : "s"}{" "}
                      have errors and won&apos;t be added (
                      {countBy(bulkAnalysis.errors, (e) => e.type)
                        .map(([type, n]) => `${n} ${ERROR_TYPE_LABELS[type] ?? type}`)
                        .join(", ")}
                      ) ({bulkExpanded.has("errors") ? "hide" : "click to view"})
                    </button>
                    {bulkExpanded.has("errors") && (
                      <ul className="mt-2 list-disc pl-5 text-zinc-700">
                        {bulkAnalysis.errors.map((e) => (
                          <li key={e.row}>
                            Row {e.row}: {e.error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )}
              </ul>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={importBulk}
                  disabled={bulkSubmitting || bulkAnalysis.willAdd.count === 0}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {bulkSubmitting
                    ? "Adding..."
                    : bulkAnalysis.willAdd.count === 0
                    ? "Nothing to add"
                    : `Add ${bulkAnalysis.willAdd.count} item${bulkAnalysis.willAdd.count === 1 ? "" : "s"} now`}
                </button>
                <button
                  onClick={() => {
                    setBulkAnalysis(null);
                    setBulkExpanded(new Set());
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Go back and edit file
                </button>
              </div>
            </div>
          )}

          {bulkResult && (
            <div className="mb-3 text-sm">
              <p className="text-teal-700">
                Added {bulkResult.created} product{bulkResult.created === 1 ? "" : "s"}
                {bulkResult.created > 0 && (
                  <>
                    {" "}
                    (
                    {Object.entries(bulkResult.byCategory)
                      .filter(([, n]) => n > 0)
                      .map(([cat, n]) => `${n} ${CATEGORY_LABELS[cat] ?? cat}`)
                      .join(", ")}
                    )
                  </>
                )}
                .
              </p>
              {bulkResult.existingDuplicates.length > 0 && (
                <p className="mt-1 text-amber-700">
                  Skipped {bulkResult.existingDuplicates.length} row
                  {bulkResult.existingDuplicates.length === 1 ? "" : "s"} already in the system as an exact match.
                </p>
              )}
              {bulkResult.fileDuplicates.length > 0 && (
                <p className="mt-1 text-amber-700">
                  Skipped {bulkResult.fileDuplicates.length} row{bulkResult.fileDuplicates.length === 1 ? "" : "s"}{" "}
                  duplicated elsewhere in the file.
                </p>
              )}
              {bulkResult.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-red-600">
                  {bulkResult.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {bulkReview.length > 0 && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3">
              <p className="mb-2 text-sm font-medium text-amber-800">
                {bulkReview.length} row{bulkReview.length === 1 ? "" : "s"} look similar to an existing product —
                resolve each before they&apos;re added:
              </p>
              <div className="flex flex-col gap-2">
                {bulkReview.map((r) => (
                  <div key={r.row} className="rounded border border-zinc-200 bg-white p-2 text-sm">
                    <p className="text-zinc-800">
                      Row {r.row}: <strong>{String(r.product.itemName)}</strong> · {String(r.product.brand)} ·{" "}
                      {String(r.product.size)}
                    </p>
                    <p className="text-zinc-500">
                      Similar to: {r.candidate.itemName} · {r.candidate.brand} · {r.candidate.size} (stock{" "}
                      {r.candidate.quantityInStock}, ₦{r.candidate.retailPrice.toFixed(2)})
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button
                        disabled={bulkReviewBusyRow === r.row}
                        onClick={() => resolveBulkReviewRow(r, "new")}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        No, different — add separately
                      </button>
                      <button
                        disabled={bulkReviewBusyRow === r.row}
                        onClick={() => resolveBulkReviewRow(r, "batch")}
                        className="rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                      >
                        Yes, new batch
                      </button>
                      <button
                        disabled={bulkReviewBusyRow === r.row}
                        onClick={() => resolveBulkReviewRow(r, "merge")}
                        className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                      >
                        Yes, merge completely
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!bulkAnalysis && (
            <button
              onClick={analyzeBulk}
              disabled={bulkAnalyzing || !bulkText.trim()}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {bulkAnalyzing ? "Checking..." : "Check file"}
            </button>
          )}
        </div>
      )}

      {visibleProducts.length > 0 && (
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
              <th className="px-3 py-2 sticky left-0 z-20 bg-zinc-50 border-r border-zinc-200 shadow-[1px_0_0_0_#e5e7eb]">Item name</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">Stock</th>
              {isAdmin && <th className="px-3 py-2">CostPrice</th>}
              <th className="px-3 py-2">{isAdmin ? "Retail" : "Selling price"}</th>
              {isAdmin && (
                <>
                  <th className="px-3 py-2">Wholesale</th>
                  <th className="px-3 py-2">Distributor</th>
                </>
              )}
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Expiry</th>
              {(isAdmin || canEditStock) && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => {
              const editing = editingId === product._id;
              const expiryStatus = getExpiryStatus(product.expiryDate);
              return (
                <tr
                  key={product._id}
                  className={`border-b border-zinc-100 last:border-0 ${EXPIRY_ROW_CLASS[expiryStatus.level]}`}
                >
                  {editing ? (
                    <>
                      <td className="px-3 py-2 sticky left-0 z-10 bg-white border-r border-zinc-100 shadow-[1px_0_0_0_#f4f4f5]">
                        <input
                          value={String(editForm.itemName ?? "")}
                          onChange={(e) => setEditForm({ ...editForm, itemName: e.target.value })}
                          className="w-28 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={String(editForm.brand ?? "")}
                          onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                          className="w-24 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={String(editForm.size ?? "")}
                          onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editForm.category as ProductCategory}
                          onChange={(e) =>
                            setEditForm({ ...editForm, category: e.target.value as ProductCategory })
                          }
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        >
                          <option value="supermarket">Supermarket</option>
                          <option value="medicine">Medicine</option>
                          <option value="non-medicine">Non-medicine</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="min-w-[120px]">
                          <label className="flex items-center gap-1 text-xs text-zinc-600">
                            <input
                              type="checkbox"
                              checked={editHierarchyEnabled}
                              onChange={(e) => setEditHierarchyEnabled(e.target.checked)}
                              className="rounded border-zinc-300"
                            />
                            Forms
                          </label>
                          {editHierarchyEnabled && (
                            <div className="mt-1 flex flex-col gap-1">
                              {editLevels.map((level, i) => (
                                <div key={i} className="flex items-center gap-1">
                                  <div className="w-20">
                                    <UnitNameInput
                                      value={level.unitName}
                                      onChange={(v) => updateEditLevel(i, { unitName: v })}
                                      suggestions={unitNameSuggestions}
                                      placeholder={i === 0 ? "e.g. carton" : "e.g. piece"}
                                      className="w-full rounded border border-zinc-300 px-1 py-0.5 text-xs"
                                    />
                                  </div>
                                  {i > 0 && (
                                    <>
                                      <span className="text-[10px] text-zinc-400">×</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={level.unitsPerParent}
                                        onChange={(e) => updateEditLevel(i, { unitsPerParent: e.target.value })}
                                        className="w-10 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                                      />
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeEditLevel(i)}
                                    className="text-[10px] text-red-500 hover:underline"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={addEditLevel}
                                className="text-[10px] text-teal-700 hover:underline"
                              >
                                + level
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editForm.quantityInStock as string | number ?? ""}
                          onChange={(e) => setEditForm({ ...editForm, quantityInStock: e.target.value })}
                          className="w-16 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editForm.costPrice as string | number}
                          onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                          className="w-20 rounded border border-zinc-300 bg-orange-50/50 px-1 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editForm.retailPrice as string | number}
                          onChange={(e) => setEditForm({ ...editForm, retailPrice: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editForm.wholesalePrice as string | number}
                          onChange={(e) => setEditForm({ ...editForm, wholesalePrice: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-1 py-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editForm.distributorPrice as string | number}
                            onChange={(e) => setEditForm({ ...editForm, distributorPrice: e.target.value })}
                            className="w-20 rounded border border-zinc-300 px-1 py-1 text-sm"
                          />
                        </td>
                      <td className="px-3 py-2">
                        <input
                          value={String(editForm.batchNumber ?? "")}
                          onChange={(e) => setEditForm({ ...editForm, batchNumber: e.target.value })}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={editForm.expiryDate ? String(editForm.expiryDate).slice(0, 10) : ""}
                          onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })}
                          className="rounded border border-zinc-300 px-1.5 py-1"
                        />
                        <div className="flex flex-col gap-1 p-3">
                          <label className="text-xs font-semibold text-zinc-600">Product Image (optional)</label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleImageUpload(e, true)}
                            className="text-sm file:mr-4 file:rounded-full file:border-0 file:bg-blue-50 file:px-4 file:py-1 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                          />
                          {imageUploading && <span className="text-xs text-blue-600">Uploading...</span>}
                          {typeof editForm.imageUrl === "string" && (
                            <img src={editForm.imageUrl} alt="Preview" className="mt-2 h-16 w-16 rounded object-cover" />
                          )}
                        </div>
                      </td>
                      <td className="flex gap-2 px-3 py-2">
                        <button
                          onClick={() => saveEdit(product._id)}
                          className="text-teal-700 hover:underline"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:underline">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 font-medium text-zinc-900 sticky left-0 z-10 bg-white border-r border-zinc-100 shadow-[1px_0_0_0_#f4f4f5]">
                        <div className="flex items-center gap-2">
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt={product.itemName} className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-400">
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                <line x1="12" y1="22.08" x2="12" y2="12"></line>
                              </svg>
                            </div>
                          )}
                          {product.itemName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{product.brand}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.size}</td>
                      <td className="px-3 py-2 text-zinc-600">{product.category}</td>
                      <td className="px-3 py-2 text-zinc-600">
                        {product.unitHierarchy && product.unitHierarchy.length > 0
                          ? product.unitHierarchy.map((l) => l.unitName).join(" → ")
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{product.quantityInStock}</td>
                      {isAdmin && (
                        <td className="px-3 py-2 font-medium text-orange-600">₦{(product.costPrice || 0).toFixed(2)}</td>
                      )}
                      <td className="px-3 py-2 text-zinc-600">₦{product.retailPrice.toFixed(2)}</td>
                      {isAdmin && (
                        <>
                          <td className="px-3 py-2 text-zinc-600">₦{product.wholesalePrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-zinc-600">₦{product.distributorPrice.toFixed(2)}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-zinc-600">{product.batchNumber || "—"}</td>
                      <td className={`px-3 py-2 ${EXPIRY_TEXT_CLASS[expiryStatus.level]}`}>
                        {product.expiryDate ? product.expiryDate.slice(0, 10) : "—"}
                        {expiryStatus.label && <div className="text-xs">{expiryStatus.label}</div>}
                      </td>
                      {(isAdmin || canEditStock) && (
                        <td className="relative px-3 py-2">
                          <button
                            onClick={() =>
                              setActionsMenuOpenId(actionsMenuOpenId === product._id ? null : product._id)
                            }
                            className="flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                          >
                            Select
                            <span aria-hidden>▾</span>
                          </button>
                          {actionsMenuOpenId === product._id && (
                            <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                              <Link
                                href={`/products/${product._id}/batches${branchId ? `?branchId=${branchId}` : ""}`}
                                onClick={() => setActionsMenuOpenId(null)}
                                className="block px-3 py-1.5 text-zinc-600 hover:bg-zinc-50"
                              >
                                Batches
                              </Link>
                              {isAdmin && (
                                <button
                                  onClick={() => {
                                    startEdit(product);
                                    setActionsMenuOpenId(null);
                                  }}
                                  className="block w-full px-3 py-1.5 text-left text-teal-700 hover:bg-zinc-50"
                                >
                                  Edit
                                </button>
                              )}
                              {(isAdmin || canEditStock) && (
                                <button
                                  onClick={() => {
                                    openAdjustStock(product);
                                    setActionsMenuOpenId(null);
                                  }}
                                  className="block w-full px-3 py-1.5 text-left text-teal-700 hover:bg-zinc-50"
                                >
                                  Adjust stock
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => {
                                    openAdjustAlertQty(product);
                                    setActionsMenuOpenId(null);
                                  }}
                                  className="block w-full px-3 py-1.5 text-left text-teal-700 hover:bg-zinc-50"
                                >
                                  Adjust alert qty
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => {
                                    deleteProduct(product._id);
                                    setActionsMenuOpenId(null);
                                  }}
                                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-zinc-50"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 12 : canEditStock ? 10 : 9} className="px-3 py-6 text-center text-zinc-500">
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="mt-8">
          <button
            onClick={() => setToolsExpanded((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <span className={`inline-block transition-transform ${toolsExpanded ? "rotate-90" : ""}`}>›</span>
            Catalog management (import batches, deletion log, danger zone)
          </button>

          {toolsExpanded && (
            <div className="mt-3 flex flex-col gap-6">
              {importBatches.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-2 text-sm font-semibold text-zinc-900">Import batches</h2>
                  <p className="mb-3 text-sm text-zinc-600">
                    Every bulk file upload is saved as a batch. Deleting a batch removes every item it added to
                    the catalog in one action — handy for undoing a bad file without hunting down each row.
                  </p>
                  <div className="flex flex-col gap-2">
                    {importBatches.map((batch) => (
                      <div
                        key={batch._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 p-2 text-sm"
                      >
                        <div className="text-zinc-700">
                          <span className="font-medium">{batch.fileName || "Pasted CSV"}</span>{" "}
                          <span className="text-zinc-400">
                            · {new Date(batch.createdAt).toLocaleString()} · by {batch.uploadedByName}
                          </span>
                          <div className="text-zinc-500">
                            {batch.remainingCount} item{batch.remainingCount === 1 ? "" : "s"} still in the
                            catalog
                            {batch.remainingCount !== batch.itemCount && ` (added ${batch.itemCount})`}
                          </div>
                        </div>
                        <button
                          disabled={deletingBatchId === batch._id}
                          onClick={() => deleteImportBatch(batch)}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          {deletingBatchId === batch._id ? "Deleting..." : "Delete batch"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-zinc-900">Deletion log</h2>
                <p className="mb-3 text-sm text-zinc-600">
                  Every deletion on this page — single item, batch, or the whole catalog — is recorded here.
                  Batch and whole-catalog deletions include a downloadable CSV of exactly what was removed, in
                  the same format the bulk importer accepts, so you can re-add it if the deletion turns out to
                  have been in error.
                </p>
                {deletionLogs.length === 0 ? (
                  <p className="text-sm text-zinc-500">No deletions recorded yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {deletionLogs.map((log) => (
                      <div key={log._id} className="rounded border border-zinc-200 p-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-zinc-700">
                            <span className="font-medium">{log.summary}</span>{" "}
                            <span className="text-zinc-400">
                              · {new Date(log.createdAt).toLocaleString()} · by {log.deletedByName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {log.type === "single" && (
                              <button
                                onClick={() => toggleDeletionLogExpanded(log._id)}
                                className="text-xs font-medium text-teal-700 hover:underline"
                              >
                                {expandedDeletionLogs.has(log._id) ? "Hide details" : "View details"}
                              </button>
                            )}
                            {log.hasCsv && (
                              <a
                                href={`/api/deletion-logs/${log._id}/download${branchId ? `?branchId=${branchId}` : ""}`}
                                className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                              >
                                Download CSV
                              </a>
                            )}
                          </div>
                        </div>
                        {log.type === "single" && expandedDeletionLogs.has(log._id) && log.productSnapshot && (
                          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-zinc-50 p-2 text-xs text-zinc-700 sm:grid-cols-3">
                            <div>
                              <dt className="text-zinc-400">Item name</dt>
                              <dd>{log.productSnapshot.itemName}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Brand</dt>
                              <dd>{log.productSnapshot.brand}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Size</dt>
                              <dd>{log.productSnapshot.size}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Category</dt>
                              <dd>{log.productSnapshot.category}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Stock at deletion</dt>
                              <dd>{log.productSnapshot.quantityInStock}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Retail price</dt>
                              <dd>₦{log.productSnapshot.retailPrice.toFixed(2)}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Wholesale price</dt>
                              <dd>₦{log.productSnapshot.wholesalePrice.toFixed(2)}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Distributor price</dt>
                              <dd>₦{log.productSnapshot.distributorPrice.toFixed(2)}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Batch number</dt>
                              <dd>{log.productSnapshot.batchNumber || "—"}</dd>
                            </div>
                            <div>
                              <dt className="text-zinc-400">Expiry date</dt>
                              <dd>{log.productSnapshot.expiryDate ? log.productSnapshot.expiryDate.slice(0, 10) : "—"}</dd>
                            </div>
                          </dl>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h2 className="mb-1 text-sm font-semibold text-red-900">Danger zone</h2>
                <p className="mb-3 text-sm text-red-800">
                  Permanently delete every product in this branch&apos;s catalog. This cannot be undone.
                </p>
                {!deleteAllOpen ? (
                  <button
                    onClick={openDeleteAllConfirm}
                    className="rounded-lg border border-red-600 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    Delete all products in this catalog
                  </button>
                ) : (
                  <div className="rounded border border-red-300 bg-white p-3">
                    {deleteAllCount === null ? (
                      <p className="text-sm text-zinc-600">Checking the current catalog...</p>
                    ) : (
                      <>
                        <p className="mb-2 text-sm text-zinc-800">
                          This will permanently delete <strong>{deleteAllCount}</strong> product
                          {deleteAllCount === 1 ? "" : "s"} from this branch&apos;s catalog, plus any saved
                          import batches. A downloadable copy will be kept in the deletion log below. Type{" "}
                          <strong>DELETE</strong> to confirm.
                        </p>
                        <input
                          type="text"
                          value={deleteAllConfirmText}
                          onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                          placeholder="DELETE"
                          className="mb-2 w-full max-w-xs rounded border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                        />
                      </>
                    )}
                    {deleteAllError && <p className="mb-2 text-sm text-red-600">{deleteAllError}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={confirmDeleteAll}
                        disabled={deleteAllCount === null || deleteAllConfirmText !== "DELETE" || deleteAllSubmitting}
                        className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        {deleteAllSubmitting
                          ? "Deleting..."
                          : deleteAllCount === null
                          ? "Loading..."
                          : `Permanently delete ${deleteAllCount} product${deleteAllCount === 1 ? "" : "s"}`}
                      </button>
                      <button
                        onClick={() => setDeleteAllOpen(false)}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {adjustingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
            <h2 className="mb-1 text-base font-semibold text-zinc-900">Adjust stock</h2>
            <p className="mb-4 text-sm text-zinc-600">{formatProductLabel(adjustingProduct)}</p>

            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Current: {adjustingProduct.quantityInStock} — new count
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={adjustNewQuantity}
              onChange={(e) => setAdjustNewQuantity(e.target.value)}
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              autoFocus
            />

            <label className="mb-1 block text-sm font-medium text-zinc-700">Reason</label>
            <input
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. physical recount, damaged, found extra"
              className="mb-4 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />

            {adjustError && <p className="mb-3 text-sm text-red-600">{adjustError}</p>}

            <p className="mb-4 text-xs text-zinc-500">
              An increase creates a new batch for the difference; a decrease draws down existing
              batches soonest-expiry-first, same as a sale would.
            </p>

            <div className="flex gap-2">
              <button
                onClick={submitAdjustStock}
                disabled={adjustSubmitting}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {adjustSubmitting ? "Saving..." : "Save adjustment"}
              </button>
              <button
                onClick={() => setAdjustingProduct(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustingAlertProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
            <h2 className="mb-1 text-base font-semibold text-zinc-900">Adjust alert quantity</h2>
            <p className="mb-4 text-sm text-zinc-600">{formatProductLabel(adjustingAlertProduct)}</p>

            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Current stock: {adjustingAlertProduct.quantityInStock} — alert when at or below
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={adjustAlertQuantity}
              onChange={(e) => setAdjustAlertQuantity(e.target.value)}
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              autoFocus
            />

            {adjustAlertError && <p className="mb-3 text-sm text-red-600">{adjustAlertError}</p>}

            <div className="flex gap-2">
              <button
                onClick={submitAdjustAlertQty}
                disabled={adjustAlertSubmitting}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {adjustAlertSubmitting ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setAdjustingAlertProduct(null)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiAssistant && (
        <AiProductAssistant
          onClose={() => setShowAiAssistant(false)}
          onSave={async (newProduct) => {
            try {
              const res = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newProduct),
              });
              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to add product");
              }
              setShowAiAssistant(false);
              loadProducts();
            } catch (err: any) {
              alert(err.message);
            }
          }}
        />
      )}
    </div>
  );
}
