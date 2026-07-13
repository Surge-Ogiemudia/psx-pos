import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import Branch from "@/models/Branch";
import Store from "@/models/Store";
import User from "@/models/User";
import { slugify } from "@/lib/slug";
import { isPlatformOnboardAuthed, PLATFORM_ONBOARD_COOKIE } from "@/lib/platformOnboardAuth";
import { handleApiError } from "@/lib/apiError";

export async function POST(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(PLATFORM_ONBOARD_COOKIE)?.value;
    if (!isPlatformOnboardAuthed(cookieValue)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }

    await dbConnect();
    const body = await request.json();

    const pharmacyName = typeof body.pharmacyName === "string" ? body.pharmacyName.trim() : "";
    const branchName = typeof body.branchName === "string" ? body.branchName.trim() : "Main Branch";
    const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "";
    const adminPhone = typeof body.adminPhone === "string" ? body.adminPhone.trim() : "";
    const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const brandColor = typeof body.brandColor === "string" && body.brandColor ? body.brandColor : "#0f766e";
    const logoUrl = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";

    if (!pharmacyName) return NextResponse.json({ error: "Pharmacy name is required" }, { status: 400 });
    if (!adminName) return NextResponse.json({ error: "Admin name is required" }, { status: 400 });
    if (!adminPhone) return NextResponse.json({ error: "Admin phone is required" }, { status: 400 });

    const adminPassword =
      typeof body.adminPassword === "string" && body.adminPassword.trim()
        ? body.adminPassword.trim()
        : crypto.randomBytes(9).toString("base64url");

    const requestedSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : pharmacyName;
    const slug = slugify(requestedSlug);
    if (!slug) return NextResponse.json({ error: "Could not derive a usable slug" }, { status: 400 });

    const existingPhone = await User.findOne({ phoneNumber: adminPhone }).lean();
    if (existingPhone) {
      return NextResponse.json(
        { error: `A user with phone number ${adminPhone} already exists (phone numbers must be globally unique)` },
        { status: 409 }
      );
    }
    const existingSlug = await Pharmacy.findOne({ slug }).lean();
    if (existingSlug) {
      return NextResponse.json(
        { error: `Slug "${slug}" is already taken by "${existingSlug.pharmacyName}"` },
        { status: 409 }
      );
    }

    const dbSession = await mongoose.startSession();
    let result: { pharmacyId: string; slug: string } | null = null;
    try {
      await dbSession.withTransaction(async () => {
        const pharmacyDocs = await Pharmacy.create(
          [
            {
              pharmacyName,
              slug,
              logoUrl,
              brandColor,
              contactInfo: { email, phone, address },
            },
          ],
          { session: dbSession }
        );
        const pharmacy = pharmacyDocs[0];

        await Branch.create([{ pharmacyId: pharmacy._id, branchName, location }], { session: dbSession });

        if (storeName) {
          await Store.create([{ pharmacyId: pharmacy._id, storeName, location }], { session: dbSession });
        }

        await User.create(
          [
            {
              pharmacyId: pharmacy._id,
              name: adminName,
              role: "admin",
              phoneNumber: adminPhone,
              passwordHash: await bcrypt.hash(adminPassword, 12),
            },
          ],
          { session: dbSession }
        );

        result = { pharmacyId: pharmacy._id.toString(), slug: pharmacy.slug };
      });
    } finally {
      await dbSession.endSession();
    }
    if (!result) throw new Error("Onboarding transaction did not complete");
    const created = result as { pharmacyId: string; slug: string };

    return NextResponse.json({
      ...created,
      loginUrl: `https://${slug}.pos.psx.ng`,
      adminPhone,
      adminPassword,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
