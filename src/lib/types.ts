export type PriceTier = "retail" | "wholesale" | "distributor";
export type PaymentMethod = "cash" | "card" | "mobile_money";
export type ProductCategory = "medicine" | "non-medicine" | "supermarket";

export interface ProductJSON {
  _id: string;
  name: string;
  category: ProductCategory;
  quantityInStock: number;
  retailPrice: number;
  wholesalePrice: number;
  distributorPrice: number;
  batchNumber?: string;
  expiryDate?: string | null;
}

export interface SaleItemJSON {
  productId: string;
  productName: string;
  quantity: number;
  priceTierUsed: PriceTier;
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
  name: string;
  role: "admin" | "staff" | "store_manager" | "store_keeper";
  phoneNumber: string;
  branchId?: string | null;
  storeId?: string | null;
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
  name: string;
  category: ProductCategory;
  baseUnitName: string;
  quantityInStock: number;
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
  batchNumber?: string;
  expiryDate?: string | null;
  receivedAt: string;
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

export type ActivityAction = "intake" | "dispense_setting" | "push" | "sell" | "store_created" | "buyer_created";

export interface ActivityLogJSON {
  _id: string;
  actorName: string;
  action: ActivityAction;
  summary: string;
  timestamp: string;
}
