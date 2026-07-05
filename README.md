# PharmaStackX POS

Standalone, white-label, multi-tenant pharmacy point-of-sale system. Built with Next.js (App Router), MongoDB/Mongoose, and NextAuth.js (Auth.js v5).

Every record is scoped by `pharmacyId` (and `branchId`/`storeId`), so any number of pharmacies can run on the same deployment with fully isolated data and independent branding.

Two kinds of location: **retail branches** (sell to end customers via the POS) and **bulk stores** (warehouses that receive stock in bulk packaging, then push it down to branches/sister stores or sell it directly to distributors/wholesalers/retailers). A branch never pushes stock anywhere — it's a leaf node that only ever sells.

## Stack

- **Frontend/Backend:** Next.js 16 (App Router, Route Handlers), Tailwind CSS
- **Database:** MongoDB via Mongoose
- **Auth:** NextAuth.js v5, Credentials provider (phone number + password), JWT sessions, bcrypt password hashing, DB-backed lockout after repeated failed logins
- **Hosting target:** Vercel

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the env template and fill in a MongoDB connection string (a replica set / MongoDB Atlas cluster is required — sales use multi-document transactions for atomic stock deduction):
   ```bash
   cp .env.local.example .env.local
   ```
   Generate `AUTH_SECRET` with `npx auth secret` or `openssl rand -base64 33`.
3. Onboard the first pharmacy (creates a Pharmacy, one Branch, an admin user, a staff user, and a handful of sample products):
   ```bash
   npm run seed
   ```
   The script prints the admin and staff phone numbers/passwords to log in with.
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Onboarding additional pharmacies

Onboarding a new pharmacy is a data step, not a code change — the whole app is multi-tenant off a single shared MongoDB database, scoped by `pharmacyId`/`branchId`. Run:

```bash
npm run onboard -- \
  --pharmacy "City Pharmacy" \
  --branch "Main Branch" \
  --admin-name "Jane Doe" \
  --admin-phone "+2348011112222" \
  --color "#1d4ed8" \
  --logo "https://.../logo.png" \
  --email "info@citypharmacy.com" \
  --phone "+2348012345678" \
  --address "10 Broad St, Lagos" \
  --store "Main Bulk Store"
```

This creates the `Pharmacy` (name, brand color, logo, contact info), one `Branch`, an admin `User`, and optionally one bulk `Store` (`--store`, optional), then prints the admin's login credentials (a random password is generated if `--admin-password` isn't passed). The admin signs in and adds their own products, staff, and stores — no redeploy needed. `scripts/seed.mjs` is a separate, unrelated script that seeds fixed demo data for local development only.

## Data model

**Retail side:**
- **Pharmacy** — tenant root: name, logo, brand color, contact info.
- **Branch** — a retail outlet, belongs to a Pharmacy.
- **Product** — belongs to a Pharmacy + Branch. Three price tiers (retail/wholesale/distributor), stock quantity, optional batch number + expiry date.
- **Sale** — belongs to a Pharmacy + Branch + User. Line items capture the price tier used and the price at time of sale.

**Bulk store side:**
- **Store** — a bulk warehouse location, belongs to a Pharmacy. A separate kind of location from Branch — it can push stock to sister stores and branches; a Branch never pushes anywhere.
- **StoreProduct** — a store's catalog entry: name, category, and `quantityInStock` cached in a canonical base unit (e.g. "piece").
- **StoreBatch** — one document per intake. Carries its own `unitHierarchy` snapshot (e.g. 1 carton = 4 boxes = 3 packs/box = 10 pieces/pack), the received form/quantity/purchase amount, and `remainingBaseUnitQuantity` decremented by pushes/sells. Different batches of the same product can have different packaging without breaking stock math.
- **DispenseSetting** — per batch, per channel (`sister_store` / `branch` / `distributor` / `wholesaler` / `retailer`): the price for one unit of a given form. Sister-store transfers default to cost (no markup); everything else is set explicitly.
- **StoreTransfer** — a push (store→store or store→branch): no payment, just an atomic stock move. Draws from the single oldest (FIFO) batch with enough remaining stock — a request that would need to span multiple batches errors out asking for a smaller quantity, rather than silently mixing batches with different pricing.
- **Buyer** — a distributor/wholesaler/retailer, auto-created (case-insensitive, per pharmacy + type) the first time a sale names them; tracks lifetime purchase total and last purchase date.
- **StoreSale** — a sell (store→external buyer): has a payment method, same single-batch FIFO draw as a push.
- **ActivityLog** — an append-only "story" of every intake/dispense-setting/push/sell, written inside the same DB transaction as the action it describes so a log entry can never go out of sync with what actually happened.

**Auth:**
- **User** — belongs to a Pharmacy, and to exactly one of: a Branch (`staff`), a Store (`store_keeper`), or neither (`admin` and `store_manager`, which are pharmacy-wide). Phone number is the login identifier (globally unique). Passwords are bcrypt-hashed; failed logins are tracked with a 15-minute lockout after 5 attempts.

## Core flows

- **Auth** — phone number + password login, JWT session carries `pharmacyId`, `branchId`/`storeId` (nullable), and `role` (`admin` | `staff` | `store_manager` | `store_keeper`). `admin` and `store_manager` are pharmacy-wide; every other route re-derives tenant scope from the session (via `getBranchScope`/`getStoreScope` in `src/lib/session.ts`) rather than trusting a client-supplied ID. Since admin has no fixed branch, `NavBar` carries a branch switcher (cookie-backed) so admin can pick which branch it's acting on for Catalog/Staff/Reports/POS.
- **Catalog** (`/products`) — search/list scoped to the caller's pharmacy + branch. Admins can add, edit, bulk-import (CSV), and adjust stock; staff have read-only access.
- **Point of sale** (`/pos`) — staff build a cart from the catalog and complete a sale at the one retail price (no tier picker — that's an admin-only concern in `/products`). Stock is decremented atomically inside a MongoDB transaction that fails the whole sale if any line item doesn't have enough stock.
- **Staff accounts** (`/staff`, admin only) — create/edit/remove staff, admin, store manager, and store keeper accounts (with branch/store assignment where relevant), reset passwords.
- **Reports** (`/reports`) — daily totals and date-range sales history. Admin sees a pharmacy-wide aggregate by default, or a specific branch if one is selected; staff always see their own branch.
- **Bulk stores** (`/store`, `/stores` admin-only) — receive stock (`/store/intake`, with a dynamic packaging-hierarchy builder), set per-channel prices (`/store/batches/[id]/dispense`, with a live nested-quantity breakdown), then push or sell (`/store/push-sell`). Every confirmation screen stays editable up to final submit. `/store/history` renders the activity log as a readable narrative; `/store/buyers` is the buyer directory with purchase history drill-down.

## Out of scope for v1

Payroll, attendance/shift management, receipt printing, returns/refunds, offline mode, and any integration with the wider PharmaStackX network — that's a separate, later connector project. Within the bulk-store flow specifically: a single push/sell always draws from one batch (no automatic multi-batch spanning), and store manager/store keeper accounts must currently be created by an admin from `/staff` (no self-service store-manager signup).
