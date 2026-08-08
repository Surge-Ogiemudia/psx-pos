import Dexie, { Table } from 'dexie';

export interface LocalProduct {
  _id: string;
  name: string;
  category: string;
  sellingPrice: number;
  costPrice?: number;
  barcode?: string;
  quantity: number;
  distributorPrice?: number;
  forms?: { formName: string; conversionRate: number }[];
  isCustom?: boolean;
}

export interface PendingSale {
  id?: number; // Auto-increment IndexedDB ID
  offlineReceiptNumber: string;
  customerName?: string;
  userName?: string;
  items: any[];
  totalAmount: number;
  payments: any[];
  amountTendered: number;
  changeGiven: number;
  timestamp: string;
  pharmacyId: string;
  synced: boolean;
}

export interface SyncMetadata {
  id: string; // e.g. "products"
  lastSyncedAt: string;
}

export class PosDatabase extends Dexie {
  products!: Table<LocalProduct, string>;
  pendingSales!: Table<PendingSale, number>;
  syncMetadata!: Table<SyncMetadata, string>;

  constructor() {
    super('psx-pos-db');
    
    // Define tables and indexes
    this.version(1).stores({
      products: '_id, name, barcode, category',
      pendingSales: '++id, offlineReceiptNumber, synced, timestamp',
      syncMetadata: 'id'
    });
  }
}

export const db = new PosDatabase();
