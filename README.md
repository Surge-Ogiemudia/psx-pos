# PharmaStackX POS

Standalone, white-label, multi-tenant pharmacy point-of-sale system. Built with Next.js (App Router), MongoDB/Mongoose, and NextAuth.js (Auth.js v5).

Every record is scoped by `pharmacyId` (and `branchId`), so any number of pharmacies can run on the same deployment with fully isolated data and independent branding.

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

Per the product spec, onboarding a new pharmacy is a data step, not a code change: create a `Pharmacy` document (name, logo URL, brand color, contact info), at least one `Branch`, and an admin `User`. `scripts/seed.mjs` shows the shape — duplicate/adapt it (or build an internal admin tool later) to onboard additional tenants without redeploying.

## Data model

- **Pharmacy** — tenant root: name, logo, brand color, contact info.
- **Branch** — belongs to a Pharmacy.
- **Product** — belongs to a Pharmacy + Branch. Three price tiers (retail/wholesale/distributor), stock quantity, optional batch number + expiry date.
- **User** — belongs to a Pharmacy + Branch. Role is `admin` or `staff`. Phone number is the login identifier (globally unique). Passwords are bcrypt-hashed; failed logins are tracked with a 15-minute lockout after 5 attempts.
- **Sale** — belongs to a Pharmacy + Branch + User. Line items capture the price tier used and the price at time of sale.

## Core flows

- **Auth** — phone number + password login, JWT session carries `pharmacyId`, `branchId`, and `role`. Every API route and Server Component re-derives tenant scope from the session — nothing is scoped by a client-supplied ID.
- **Catalog** (`/products`) — search/list scoped to the caller's pharmacy + branch. Admins can add, edit, and adjust stock; staff have read-only access.
- **Point of sale** (`/pos`) — staff build a cart from the catalog, pick a price tier per line, and complete a sale. Stock is decremented atomically inside a MongoDB transaction that fails the whole sale if any line item doesn't have enough stock — no overselling under concurrent sales. Unit prices are always looked up server-side from the product record, never trusted from the client.
- **Staff accounts** (`/staff`, admin only) — create/edit/remove staff and admin accounts, reset passwords.
- **Reports** (`/reports`) — daily totals and date-range sales history, scoped per pharmacy/branch.

## Out of scope for v1

Payroll, attendance/shift management, receipt printing, returns/refunds, offline mode, multi-branch UI (the data model supports it; the UI is single-branch for now), and any integration with the wider PharmaStackX network — that's a separate, later connector project.
