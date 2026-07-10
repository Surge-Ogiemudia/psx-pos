import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { dbConnect } from "@/lib/mongodb";
import Store from "@/models/Store";

export interface StoreOption {
  _id: string;
  storeName: string;
}

/**
 * store_keeper is fixed to one store. admin/store_manager are pharmacy-wide and have no fixed
 * store, so which one they're currently "acting as" comes from a client-set cookie, validated
 * against the pharmacy's real stores — same pattern as resolveActiveBranch.
 */
export async function resolveActiveStore(
  session: Session
): Promise<{ activeStoreId: string | null; stores: StoreOption[]; canSwitch: boolean }> {
  if (session.user.role === "store_keeper") {
    return { activeStoreId: session.user.storeId, stores: [], canSwitch: false };
  }
  if (session.user.role !== "admin" && session.user.role !== "store_manager") {
    return { activeStoreId: null, stores: [], canSwitch: false };
  }

  await dbConnect();
  const storeDocs = await Store.find({ pharmacyId: session.user.pharmacyId })
    .sort({ storeName: 1 })
    .lean();
  const stores: StoreOption[] = storeDocs.map((s) => ({
    _id: s._id.toString(),
    storeName: s.storeName,
  }));

  const cookieStore = await cookies();
  const cookieStoreId = cookieStore.get("activeStoreId")?.value ?? null;
  const isValid = cookieStoreId ? stores.some((s) => s._id === cookieStoreId) : false;

  return {
    activeStoreId: isValid ? cookieStoreId : (stores[0]?._id ?? null),
    stores,
    canSwitch: true,
  };
}
