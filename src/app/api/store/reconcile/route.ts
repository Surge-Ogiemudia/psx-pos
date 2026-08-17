import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/db";
import BulkReconciliationItem from "@/models/BulkReconciliationItem";
import Product from "@/models/Product";
import { resolveScope } from "@/lib/scope";
import { logActivity } from "@/lib/activityLogger";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const scope = await resolveScope(req, session);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "all";
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const query: any = { pharmacyId: scope.pharmacyId };

    if (status !== "all") {
      query.status = status;
    }

    if (search) {
      query.excelItemName = { $regex: search, $options: "i" };
    }

    const total = await BulkReconciliationItem.countDocuments(query);
    const items = await BulkReconciliationItem.find(query)
      .populate("matchedProductId")
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Stats breakdown for header
    const statsAll = await BulkReconciliationItem.aggregate([
      { $match: { pharmacyId: scope.pharmacyId } },
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
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats,
    });
  } catch (err: any) {
    console.error("GET /api/store/reconcile error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch reconciliation items" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const scope = await resolveScope(req, session);
    const body = await req.json();

    const { action, itemId, targetProductId, customProductData } = body;

    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }

    const reconItem = await BulkReconciliationItem.findOne({
      _id: itemId,
      pharmacyId: scope.pharmacyId,
    });

    if (!reconItem) {
      return NextResponse.json({ error: "Reconciliation item not found" }, { status: 404 });
    }

    // 1. MATCH ACTION
    if (action === "match") {
      if (!targetProductId) {
        return NextResponse.json({ error: "targetProductId is required for match" }, { status: 400 });
      }

      const product = await Product.findOne({
        _id: targetProductId,
        pharmacyId: scope.pharmacyId,
      });

      if (!product) {
        return NextResponse.json({ error: "Target catalog product not found" }, { status: 404 });
      }

      // Overwrite bulk store stock on matched product
      product.bulkQuantityInStock = reconItem.totalQuantity;
      await product.save();

      reconItem.matchedProductId = product._id as any;
      reconItem.status = "matched";
      reconItem.matchedAt = new Date();
      reconItem.matchedByUserId = session.user.id as any;
      await reconItem.save();

      await logActivity(null, {
        pharmacyId: scope.pharmacyId,
        scope: "global",
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "RECONCILE_MATCH_BULK_STOCK",
        description: `Matched Excel item '${reconItem.excelItemName}' to DB product '${product.itemName}' setting bulk stock to ${reconItem.totalQuantity}`,
      });

      return NextResponse.json({ success: true, item: reconItem, product });
    }

    // 2. UNMATCH / REVERT ACTION
    if (action === "unmatch") {
      if (reconItem.matchedProductId) {
        const product = await Product.findOne({
          _id: reconItem.matchedProductId,
          pharmacyId: scope.pharmacyId,
        });

        if (product) {
          // Revert bulk store stock to 0
          product.bulkQuantityInStock = 0;
          await product.save();
        }
      }

      reconItem.matchedProductId = null;
      reconItem.status = "pending";
      reconItem.matchedAt = null;
      reconItem.matchedByUserId = null;
      await reconItem.save();

      await logActivity(null, {
        pharmacyId: scope.pharmacyId,
        scope: "global",
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "RECONCILE_UNMATCH_BULK_STOCK",
        description: `Unmatched Excel item '${reconItem.excelItemName}' and reverted bulk stock`,
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

      const newProduct = await Product.create({
        pharmacyId: scope.pharmacyId,
        branchId: scope.branchId,
        itemName: name,
        brand,
        size,
        category,
        retailPrice,
        quantityInStock: 0, // Branch stock remains 0
        bulkQuantityInStock: reconItem.totalQuantity, // Bulk stock set to Excel count
      });

      reconItem.matchedProductId = newProduct._id as any;
      reconItem.status = "created_as_new";
      reconItem.matchedAt = new Date();
      reconItem.matchedByUserId = session.user.id as any;
      await reconItem.save();

      await logActivity(null, {
        pharmacyId: scope.pharmacyId,
        scope: "global",
        actorUserId: session.user.id,
        actorName: session.user.name ?? "User",
        action: "RECONCILE_CREATE_NEW_PRODUCT",
        description: `Created new product '${name}' from Excel item with bulk stock ${reconItem.totalQuantity}`,
      });

      return NextResponse.json({ success: true, item: reconItem, product: newProduct });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("POST /api/store/reconcile error:", err);
    return NextResponse.json({ error: err.message || "Failed to process reconciliation action" }, { status: 500 });
  }
}
