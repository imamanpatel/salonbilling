# Sabilling

Salon & spa management software: appointments, billing, clients, staff, inventory and reports across multiple branches.
Built in JavaScript: React + Vite frontend, Node/Express API, PostgreSQL via Prisma.

## Status

| Milestone | Scope | Status |
|---|---|---|
| **M1 Foundation** | Login & roles, branches, users, staff & service providers, services & categories (+ Excel import), GST rates, loyalty/reminder settings, holidays | ✅ Done |
| **M2 Clients & enquiries** | Clients shared across branches (segments, Excel import, 360° profile, invite codes), follow-ups, enquiries with responses and convert-to-client, Today page with birthdays/anniversaries and WhatsApp shortcuts | ✅ Done |
| **M3 Appointments** | Day calendar by provider, double-booking checks, advances, check-in/cancel/no-show, bill from appointment | ✅ Done |
| **M4 Billing / POS** | POS with GST & round-off, line/coupon/points/manual discounts, membership prices, packages, wallet, gift cards, split payments, dues, void with full reversal, printable tax invoice; catalogue for packages, memberships, coupons, gift cards | ✅ Done |
| **M5 Inventory** | Products & stock ledger, purchases & vendors, use-in-salon, adjustments, branch transfers, low-stock & expiry alerts, Excel import | ✅ Done |
| **M6 Team & expenses** | Attendance (day/month), salaries with commission & suggested payable, commission reports, expenses, staff transfers | ✅ Done |
| **M7 Messaging** | Console/Webhook/WhatsApp Cloud providers, templates, message log & retry, bulk send, daily birthday/anniversary/reminder/dues/package/service jobs | ✅ Done |
| **M8 Reports** | Live dashboard; daily summary, sales by item, staff, collections, dues, clients, enquiries, profit, all exportable to Excel | ✅ Done |
| **M9 Website & migration** | Public booking page & API, feedback form, offers & gallery, review moderation, opening-balance import | ✅ Done |

## Project layout

```
apps/api         Express REST API (Prisma, PostgreSQL)
apps/web         React admin panel (Vite, Tailwind, TanStack Query)
packages/shared  Zod schemas, money helpers and constants used by both
```

## Quick start (no PostgreSQL needed)

Uses a built-in Postgres engine (PGlite) that stores data in `apps/api/.data/`: good for trying the app and local development.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET, SEED_ADMIN_PASSWORD and
                                          # DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable&connection_limit=1&pgbouncer=true"
npm run db:local        # terminal 1: starts the local database on port 5433 (first run only, for setup)
npm run db:deploy       # terminal 2: create tables
npm run db:seed         #             create the first superadmin
# stop db:local, then from now on start everything with one command:
npm run dev:local       # database + API (http://localhost:4000) + web (http://localhost:5173)
```

## Getting started with PostgreSQL

Requires Node 22+ and PostgreSQL 14+.

```bash
npm install

# 1. Create the database (once)
createdb -U postgres sabilling

# 2. Configure the API
cp apps/api/.env.example apps/api/.env
#    then set DATABASE_URL, JWT_SECRET and SEED_ADMIN_PASSWORD

# 3. Create tables and the first superadmin
npm run db:migrate
npm run db:seed

# 4. Run API (http://localhost:4000) and web app (http://localhost:5173)
npm run dev
```

Sign in at http://localhost:5173 with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.

## Tests

```bash
npm test
```

Unit tests always run. API integration tests also run when `apps/api/.env.test` sets
`TEST_DATABASE_URL` to a database whose name ends in `_test` (it is wiped on every run):

```
TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/sabilling_test?schema=public"
```

## Conventions

- **Money is integer paise** everywhere (`pricePaise: 49900` = ₹499.00). Convert only at the edges with
  `rupeesToPaise` / `formatINR` from `@salon/shared`; never do arithmetic on rupee floats.
- **Every business record belongs to a branch.** Branch-scoped routes read the `x-branch-id` header,
  checked by `requireBranch`; load rows with `findInBranch` so other branches' ids are unreachable.
- **One validation schema per payload**, in `packages/shared/src/schemas.js`, used by the API
  (`validateBody`) and the web forms (`useApiForm`). Name form fields like the payload keys.
- **Errors** are `{ error: { code, message, details } }`; `details` maps field names to messages and is
  shown under the matching inputs.
- **Roles:** `SUPERADMIN` (everything, all branches), `ADMIN` (manages catalogue, staff, settings and
  front-desk users in their branches), `USER` (front desk; read-only on setup screens, no salary data).
