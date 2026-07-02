export type PriceTier = "retail" | "wholesale" | "distributor";
export type PaymentMethod = "cash" | "card" | "mobile_money";

export interface ProductJSON {
  _id: string;
  name: string;
  category: "medicine" | "non-medicine";
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

export interface SaleJSON {
  _id: string;
  items: SaleItemJSON[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  timestamp: string;
  userId: string;
}

export interface StaffJSON {
  _id: string;
  name: string;
  role: "admin" | "staff";
  phoneNumber: string;
}
