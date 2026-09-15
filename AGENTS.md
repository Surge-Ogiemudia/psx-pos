# PSX-POS - Project Memory & Context

> [!IMPORTANT]
> **To the Antigravity Agent:** This file is the authoritative project context for `psx-pos`. Read this upon workspace startup to ensure complete continuity with the camera-snapped stock drafts and catalog management.

---

## 1. Project Overview & Identity
- **Project Name:** `psx-pos` (PharmaStackX Point of Sale)
- **Repository Location:** `C:\Users\HP\Desktop\psx-pos`
- **Core Scope:** Point of sale terminal, pharmacy inventory catalog, multi-branch stock tracking, and automated processing of camera-snapped stock drafts.

---

## 2. Where We Stopped: Camera-Snapped Stock Drafts & Catalog Sync
- **Task:** Processing mobile camera-snapped product drafts directly into the live POS catalog for community pharmacy onboarding.
- **Current Numbers & Milestone:**
  - Initial Live POS Catalog: **8,073 products**
  - Camera-Snapped Mobile Queue: **214 drafts total** (192 in final batch + 22 earlier)
  - Successfully Processed & Live: **8,265 products**
  - Remaining Errors: **0**
  - Remaining Pending Drafts: **0**
- **Multi-Tenant Data Isolation (Crucial Rule):**
  - All items processed were strictly scoped to:
    - **Pharmacy:** `APCARE PHARMACY AND STORES` (`pharmacyId: 6aa3cdfd7f1e8b4387e43c22`)
    - **Branch:** `Main Branch` (`branchId: 6aa3d0fde6b6e0f4c19e695a`)
  - No products from this batch leak to or affect any other pharmacy in the platform.

---

## 3. Key Operational Scripts & Database
- Database: MongoDB
- Maintenance & Verification Scripts:
  - `check_sales_costs.js`, `bulk_barcode_import.js`, `fix-store-products.js`, `check-kop-stock.js`
- Next steps: Reviewing the newly added 192 live products, barcode mappings, stock levels, and price validation for APCare Pharmacy.
