import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import BulkReconciliationItem from "@/models/BulkReconciliationItem";
import Product from "@/models/Product";
import StoreProduct from "@/models/StoreProduct";
import Store from "@/models/Store";
import { requireApiSession } from "@/lib/session";
import { logActivity } from "@/lib/activityLog";

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const pharmacyIdStr = session.user.pharmacyId;
    if (!pharmacyIdStr) {
      return NextResponse.json({ error: "No pharmacy ID in session" }, { status: 400 });
    }

    const pharmacyId = new mongoose.Types.ObjectId(pharmacyIdStr);

    const status = request.nextUrl.searchParams.get("status") || "all";
    const search = request.nextUrl.searchParams.get("search") || "";
    const page = parseInt(request.nextUrl.searchParams.get("page") || "1", 10);
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);

    const query: Record<string, unknown> = { pharmacyId };

    if (status !== "all") {
      query.status = status;
    }

    if (search) {
      query.excelItemName = { $regex: search, $options: "i" };
    }

    const total = await BulkReconciliationItem.countDocuments(query);
    const items = await BulkReconciliationItem.find(query)
      .populate("matchedProductId")
      .populate("suggestedMatches.productId")
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Fetch bulk store products to attach real-time bulk store stock
    const store = await Store.findOne({ pharmacyId });
    const storeProducts = store
      ? await StoreProduct.find({ pharmacyId, storeId: store._id }).select("itemName brand size quantityInStock").lean()
      : [];

    const storeStockMap = new Map<string, number>();
    storeProducts.forEach((sp) => {
      const k = `${(sp.itemName || "").toLowerCase()}_${(sp.brand || "").toLowerCase()}_${(sp.size || "").toLowerCase()}`;
      storeStockMap.set(k, sp.quantityInStock || 0);
    });

    // Attach bulk stock numbers to items & candidate products
    const processedItems = items.map((item: any) => {
      if (item.matchedProductId) {
        const k = `${(item.matchedProductId.itemName || "").toLowerCase()}_${(item.matchedProductId.brand || "").toLowerCase()}_${(item.matchedProductId.size || "").toLowerCase()}`;
        item.matchedProductId.bulkQuantityInStock = storeStockMap.get(k) || 0;
      }

      if (item.suggestedMatches) {
        item.suggestedMatches = item.suggestedMatches.map((cand: any) => {
          if (cand.productId && typeof cand.productId === "object") {
            const k = `${(cand.productId.itemName || "").toLowerCase()}_${(cand.productId.brand || "").toLowerCase()}_${(cand.productId.size || "").toLowerCase()}`;
            cand.productId.bulkQuantityInStock = storeStockMap.get(k) || 0;
          }
          return cand;
        });
      }

      return item;
    });

    // Stats breakdown for header
    const statsAll = await BulkReconciliationItem.aggregate([
      { $match: { pharmacyId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const stats = {
      pending: 0,
      matched: 0,
      created_as_new: 0,
      ignored: 0,
      total: 0,
    };

    statsAll.forEach((s) => {
      if (s._id in stats) {
        (stats as any)[s._id] = s.count;
      }
      stats.total += s.count;
    });

    return NextResponse.json({
      items: processedItems,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      stats,
    });
  } catch (err: any) {
    console.error("GET /api/store/reconcile error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch reconciliation items" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireApiSession();
    await dbConnect();

    const pharmacyIdStr = session.user.pharmacyId;
    if (!pharmacyIdStr) {
      return NextResponse.json({ error: "No pharmacy ID in session" }, { status: 400 });
    }

    const pharmacyId = new mongoose.Types.ObjectId(pharmacyIdStr);
    const body = await request.json();

    const { action, itemId, targetProductId, customProductData } = body;

    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }

    const reconItem = await BulkReconciliationItem.findOne({
      _id: itemId,
      pharmacyId,
    });

    if (!reconItem) {
      return NextResponse.json({ error: "Reconciliation item not found" }, { status: 404 });
    }

    // Resolve store for bulk store stock updates
    const store = await Store.findOne({ pharmacyId });
    const storeId = store?._id;

    // 1. MATCH ACTION
    if (action === "match") {
      if (!targetProductId) {
        return NextResponse.json({ error: "targetProductId is required for match" }, { status: 400 });
      }

      const product = await Product.findOne({
        _id: targetProductId,
        pharmacyId,
      });

      if (!product) {
        return NextResponse.json({ error: "Target catalog product not found" }, { status: 404 });
      }

      // Overwrite Bulk Store Product stock
      if (storeId) {
        let storeProduct = await StoreProduct.findOne({
          pharmacyId,
          storeId,
          itemName: product.itemName,
          brand: product.brand,
          size: product.size,
        });

        if (storeProduct) {
          storeProduct.quantityInStock = reconItem.totalQuantity;
          await storeProduct.save();
        } else {
          await StoreProduct.create({
            pharmacyId,
            storeId,
            itemName: product.itemName,
            brand: product.brand,
            size: product.size,
            category: product.category,
            quantityInStock: reconItem.totalQuantity,
          });
        }
      }

      reconItem.matchedProductId = product._id as any;
      reconItem.status = "matched";
      reconItem.matchedAt = new Date();
      reconItem.matchedByUserId = session.user.id as any;
      await reconItem.save();

      await logActivity(null as any, {
        pharmacyId: pharmacyIdStr,
        scope: "store",
        storeId: storeId ? storeId.toString() : null,
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "stock_adjustment",
        summary: `Reconciled Bulk Store match for '${reconItem.excelItemName}' to DB product '${product.itemName}' (Qty: ${reconItem.totalQuantity})`,
      });

      return NextResponse.json({ success: true, item: reconItem, product });
    }

    // 2. UNMATCH / REVERT ACTION
    if (action === "unmatch") {
      if (reconItem.matchedProductId && storeId) {
        const product = await Product.findOne({
          _id: reconItem.matchedProductId,
          pharmacyId,
        });

        if (product) {
          const storeProduct = await StoreProduct.findOne({
            pharmacyId,
            storeId,
            itemName: product.itemName,
            brand: product.brand,
            size: product.size,
          });

          if (storeProduct) {
            storeProduct.quantityInStock = 0;
            await storeProduct.save();
          }
        }
      }

      reconItem.matchedProductId = null;
      reconItem.status = "pending";
      reconItem.matchedAt = null;
      reconItem.matchedByUserId = null;
      await reconItem.save();

      await logActivity(null as any, {
        pharmacyId: pharmacyIdStr,
        scope: "store",
        storeId: storeId ? storeId.toString() : null,
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "stock_adjustment",
        summary: `Reverted Bulk Store match for '${reconItem.excelItemName}'`,
      });

      return NextResponse.json({ success: true, item: reconItem });
    }

    // 3. CREATE AS NEW PRODUCT ACTION
    if (action === "create_new") {
      const name = customProductData?.itemName || reconItem.excelItemName;
      const brand = customProductData?.brand || reconItem.brand;
      const size = customProductData?.size || reconItem.size;
      const category = customProductData?.category || reconItem.category || "supermarket";
      const retailPrice = customProductData?.retailPrice || 0;

      const branchId = session.user.branchId || (storeId ? storeId : pharmacyId);

      const newProduct = await Product.create({
        pharmacyId,
        branchId,
        itemName: name,
        brand,
        size,
        category,
        retailPrice,
        wholesalePrice: retailPrice,
        distributorPrice: retailPrice,
        quantityInStock: 0,
      });

      if (storeId) {
        await StoreProduct.create({
          pharmacyId,
          storeId,
          itemName: name,
          brand,
          size,
          category,
          quantityInStock: reconItem.totalQuantity,
        });
      }

      reconItem.matchedProductId = newProduct._id as any;
      reconItem.status = "created_as_new";
      reconItem.matchedAt = new Date();
      reconItem.matchedByUserId = session.user.id as any;
      await reconItem.save();

      await logActivity(null as any, {
        pharmacyId: pharmacyIdStr,
        scope: "store",
        storeId: storeId ? storeId.toString() : null,
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "product_create",
        summary: `Created new product '${name}' from Excel reconciliation with Bulk Store Qty ${reconItem.totalQuantity}`,
      });

      return NextResponse.json({ success: true, item: reconItem, product: newProduct });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/store/reconcile error:", err);
    return NextResponse.json({ error: err.message || "Failed to process reconciliation action" }, { status: 500 });
  }
}
