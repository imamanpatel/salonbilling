# Sabilling

Salon & spa management software: appointments, billing, clients, staff, inventory and reports across multiple branches.
Built in JavaScript: React + Vite frontend, Node/Express API, PostgreSQL via Prisma.

## Status

| Milestone | Scope | Status |
|---|---|---|
| **M1 Foundation** | Login & roles, branches, users, staff & service providers, services & categories (+ Excel import), GST rates, loyalty/reminder settings, holidays | ✅ Done |
| M2 Clients & enquiries | Client profiles, segments, follow-ups, leads | Planned |
| M3 Appointments | Calendar by provider, online booking, check-in | Planned |
| M4 Billing / POS | Bills, split payments, GST, wallet, gift cards, memberships, packages, coupons, points | Planned |
| M5 Inventory | Products, vendors, purchases, lots & expiry, usage, transfers | Planned |
| M6 HR | Attendance, salaries, commissions | Planned |
| M7 Messaging | SMS / WhatsApp / email, templates, automatic reminders | Planned |
| M8 Reports | Daily, billing, provider, balance, sales reports + exports | Planned |
| M9 Website & migration | Public booking API, offers, gallery, feedback; import from the old system | Planned |

## Project layout

```
apps/api         Express REST API (Prisma, PostgreSQL)
apps/web         React admin panel (Vite, Tailwind, TanStack Query)
packages/shared  Zod schemas, money helpers and constants used by both
```

## Getting started

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
