import { headers } from "next/headers";
import { dbConnect } from "@/lib/mongodb";
import Pharmacy from "@/models/Pharmacy";
import LoginClient from "./LoginClient";

const DEFAULT_BRAND_NAME = process.env.LOGIN_BRAND_NAME || "PharmaStackX POS";

// Matches "monak" out of "monak.pos.psx.ng" — the bare "pos.psx.ng" (no tenant label) and any
// other host (localhost, pos.pharmastackx.com once it redirects here, etc.) fall through to the
// generic default branding below.
function extractSlug(host: string | null): string | null {
  if (!host) return null;
  const match = host.match(/^([a-z0-9-]+)\.pos\.psx\.ng(?::\d+)?$/i);
  return match ? match[1].toLowerCase() : null;
}

export default async function LoginPage() {
  const host = (await headers()).get("host");
  const slug = extractSlug(host);

  let brandName = DEFAULT_BRAND_NAME;
  let logoUrl: string | undefined;
  let brandColor: string | undefined;

  if (slug) {
    await dbConnect();
    const pharmacy = await Pharmacy.findOne({ slug }).lean();
    if (pharmacy) {
      brandName = pharmacy.pharmacyName;
      logoUrl = pharmacy.logoUrl || undefined;
      brandColor = pharmacy.brandColor || undefined;
    }
  }

  return <LoginClient brandName={brandName} logoUrl={logoUrl} brandColor={brandColor} />;
}
