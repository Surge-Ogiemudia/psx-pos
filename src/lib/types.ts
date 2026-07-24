export type PriceTier = "retail" | "wholesale" | "distributor";
export type PaymentMethod = "cash" | "card" | "mobile_money";
export type ProductCategory = "medicine" | "non-medicine" | "supermarket";

export function formatProductLabel(p: { itemName: string; brand: string; size: string }): string {
  return `${p.itemName} · ${p.size} · ${p.brand}`;
}

export interface ProductJSON {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  category: ProductCategory;
  quantityInStock: number;
  alertQuantity: number;
  unitHierarchy?: UnitLevelJSON[] | null;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  batchNumber?: string;
  expiryDate?: string | null;
}

export interface ProductBatchJSON {
  _id: string;
  productId: string;
  quantity: number;
  remainingQuantity: number;
  batchNumber?: string;
  expiryDate?: string | null;
  receivedAt: string;
}

export interface SaleItemJSON {
  productId: string | null;
  productName: string;
  isCustom?: boolean;
  itemName?: string | null;
  brand?: string | null;
  size?: string | null;
  category?: ProductCategory | null;
  quantity: number;
  form?: string | null;
  formQuantity?: number | null;
  priceTierUsed: PriceTier | "custom";
  unitPrice: number;
  lineTotal: number;
}

export interface PaymentLineJSON {
  method: PaymentMethod;
  amount: number;
}

export interface SaleJSON {
  _id: string;
  items: SaleItemJSON[];
  totalAmount: number;
  payments: PaymentLineJSON[];
  amountTendered: number;
  changeGiven: number;
  changeMethod: PaymentMethod;
  changeFee: number;
  timestamp: string;
  userId: string;
  userName: string;
}

export interface RefundItemJSON {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface RefundJSON {
  _id: string;
  saleId: string;
  items: RefundItemJSON[];
  totalAmount: number;
  method: PaymentMethod;
  reason?: string;
  timestamp: string;
}

export interface StaffJSON {
  _id: string;
  localId?: string | null;
  name: string;
  role: "admin" | "staff" | "store_manager" | "store_keeper";
  employeeId?: string | null;
  phoneNumber: string;
  branchId?: string | null;
  storeId?: string | null;
  branchName?: string | null;
  storeName?: string | null;
  employmentType: "full_time" | "part_time" | "contract";
  salaryType: "monthly" | "hourly";
  salaryAmount: number;
  bankAccountDetails?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  startDate: string;
  status: "active" | "inactive";
}

export type ShiftType = "morning" | "afternoon" | "evening" | "full_day" | "custom";

export interface ShiftJSON {
  _id: string;
  branchId: string;
  userId: string;
  date: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  type: ShiftType;
  notes?: string;
  staffName?: string;
}

export interface ShiftSettingsJSON {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  eveningStart: string;
  eveningEnd: string;
  fullDayStart: string;
  fullDayEnd: string;
}

export interface PharmacySettingsJSON {
  shiftSettings: ShiftSettingsJSON;
}

export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "early_exit";

export interface AttendanceJSON {
  _id: string;
  branchId: string;
  userId: string;
  shiftId?: string | null;
  date: string;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  status: AttendanceStatus;
  clockInMethod?: "pin" | "face" | null;
  clockOutMethod?: "pin" | "face" | null;
  actualHoursWorked: number;
}

export interface RosterEntryJSON {
  userId: string;
  name: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  status: AttendanceStatus | null;
  onDuty: boolean;
  wasScheduled: boolean;
}

export interface StaffCredentialStatusJSON {
  userId: string;
  hasPin: boolean;
  hasFace: boolean;
  faceEnrolledAt?: string | null;
}

export interface StoreJSON {
  _id: string;
  storeName: string;
  location?: string;
}

export interface BranchJSON {
  _id: string;
  branchName: string;
  location?: string;
}

export interface StoreProductJSON {
  _id: string;
  itemName: string;
  brand: string;
  size: string;
  category: ProductCategory;
  baseUnitName: string;
  quantityInStock: number;
  displayUnitHierarchy?: UnitLevelJSON[] | null;
  /** 20% of the most recently received batch's quantity (floor 1) — an automatic reorder-point alert, not manually set. */
  lowStockThreshold: number;
  /** Soonest expiry date among this product's batches that still have stock remaining. */
  soonestExpiryDate?: string | null;
}

export interface UnitLevelJSON {
  unitName: string;
  unitsPerParent: number;
}

export interface StoreBatchJSON {
  _id: string;
  storeId: string;
  storeProductId: string;
  productName: string;
  unitHierarchy: UnitLevelJSON[];
  receivedForm: string;
  receivedQuantity: number;
  baseUnitQuantity: number;
  remainingBaseUnitQuantity: number;
  purchaseAmount: number;
  purchaseUnitCost: number;
  supplierName?: string;
  supplierId?: string | null;
  batchNumber?: string;
  expiryDate?: string | null;
  receivedAt: string;
}

export interface SupplierJSON {
  _id: string;
  name: string;
  phoneNumber?: string;
  totalSupplyAmount: number;
  lastSupplyAt?: string | null;
}

export type TransferStatus = "in_transit" | "received";

export interface StoreTransferJSON {
  _id: string;
  fromStoreId: string;
  destinationType: "store" | "branch";
  toStoreId?: string | null;
  toBranchId?: string | null;
  productName: string;
  pushedForm: string;
  pushedQuantity: number;
  baseUnitQuantity: number;
  totalValue: number;
  status: TransferStatus;
  timestamp: string;
}

export type DispenseChannel = "sister_store" | "branch" | "distributor" | "wholesaler" | "retailer";

export const CHANNEL_LABEL: Record<DispenseChannel, string> = {
  sister_store: "Sister store",
  branch: "Retail branch",
  distributor: "Distributor",
  wholesaler: "Wholesaler",
  retailer: "Retailer",
};

export interface DispenseSettingJSON {
  _id: string;
  storeBatchId: string;
  channel: DispenseChannel;
  priceForm: string;
  priceAmount: number;
}

export type BuyerType = "distributor" | "wholesaler" | "retailer";

export interface BuyerJSON {
  _id: string;
  name: string;
  buyerType: BuyerType;
  phoneNumber?: string;
  totalPurchaseAmount: number;
  lastPurchaseAt?: string | null;
}

export interface StoreSaleJSON {
  _id: string;
  storeId: string;
  buyerId: string;
  buyerType: BuyerType;
  productName: string;
  soldForm: string;
  soldQuantity: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  timestamp: string;
}

export type ActivityAction =
  | "intake"
  | "dispense_setting"
  | "push"
  | "sell"
  | "write_off"
  | "store_created"
  | "buyer_created"
  | "delete"
  | "stock_adjustment"
  | "product_create"
  | "refund"
  | "receive";

export interface ActivityLogJSON {
  _id: string;
  actorName: string;
  action: ActivityAction;
  summary: string;
  timestamp: string;
}

export type ProductRequestStatus = "pending" | "approved" | "resolved_duplicate" | "rejected";

export interface ProductRequestJSON {
  _id: string;
  branchId: string;
  itemName: string;
  brand: string;
  size: string;
  category: ProductCategory;
  requestedPrice: number;
  quantitySold: number;
  saleId: string;
  requestedByUserId: string;
  requestedByName?: string;
  status: ProductRequestStatus;
  linkedProductId?: string | null;
  reviewedByUserId?: string | null;
  reviewNote?: string;
  createdAt: string;
}

export interface ImportBatchJSON {
  _id: string;
  fileName: string;
  itemCount: number;
  remainingCount: number;
  uploadedByName: string;
  createdAt: string;
}

export type DeletionLogType = "single" | "batch" | "delete_all";

export interface DeletionLogJSON {
  _id: string;
  type: DeletionLogType;
  deletedByName: string;
  itemCount: number;
  summary: string;
  productSnapshot?: ProductJSON | null;
  csvFileName?: string;
  hasCsv: boolean;
  createdAt: string;
}
