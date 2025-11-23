# IntelliWatt Dev Database Setup

> Related Plan Change: **[PC-2025-11-22-B] Dev Database Strategy for PuctRep / PUCT REP Directory (PLANNING)** in `docs/PROJECT_PLAN.md`.

This document describes how to configure and use a **separate dev Postgres database** for
Prisma migrations and local testing. The goal is to keep Prisma’s `migrate dev` pipeline
off of the DigitalOcean production-like database while we iterate on things like
`PuctRep` (PUCT REP directory) and other schema changes.

## 1. Why a separate dev DB?

- The DO Postgres cluster backing the live stack has historical SMT/ERCOT data and
  drifted migrations.
- We **do not** want to run `npx prisma migrate dev` against that cluster.
- Instead, we point Prisma at a clean, disposable dev database where:
  - All migrations can be applied from scratch.
  - We can safely test features like `PuctRep` and admin UIs.

## 2. Provision a dev Postgres database

You can use any Postgres target for dev:

- A local Postgres instance on your machine, or
- A managed dev DB (Neon, Supabase, another DO instance, etc.).

Example database name: `intelliwatt_dev`

You should end up with a connection string like:

```text
postgresql://<user>:<password>@<host>:<port>/intelliwatt_dev?schema=public
```

Keep this connection string handy; you will not commit it to the repo.

### Dev Database: `intelliwatt_dev` (DO cluster)

- Dedicated dev DB created on the existing DO Postgres cluster.
  - Name: `intelliwatt_dev`
  - Same host/port/user as `defaultdb`
- When running `npx prisma migrate dev`, point `DATABASE_URL` at this database, e.g.:
  ```bash
  DATABASE_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_dev?sslmode=require"
  ```
- `npx prisma migrate dev` now applies the full chain of migrations (`20251024001515_init` → … → `20251122120000_add_smt_meter_info` → `20251123035440_puct_rep_dev_setup`) against `intelliwatt_dev`.
- This database is used exclusively for schema evolution and local testing; it is **not** the same as the production-ish `defaultdb` used by Vercel and the droplet services.
- The PUCT REP / ERCOT migration is idempotent, so re-running `migrate dev` against `intelliwatt_dev` is safe even if tables already exist.
## 3. Using the dev DB with Prisma locally

When you want to run Prisma migrations or test schema-dependent code locally:

1. Open a terminal in the repo root (e.g., `intelliwatt-clean`).
2. Set `DATABASE_URL` for this shell only to point at the dev DB, then run
   `prisma migrate dev`.

PowerShell example (Windows dev machine):

```powershell
cd path\to\intelliwatt-clean
$env:DATABASE_URL = "postgresql://user:password@host:5432/intelliwatt_dev?schema=public"
npx prisma migrate dev
```

bash/zsh example (macOS/Linux dev machine):

```bash
cd /path/to/intelliwatt-clean
export DATABASE_URL="postgresql://user:password@host:5432/intelliwatt_dev?schema=public"
npx prisma migrate dev
```

After `npx prisma migrate dev` completes successfully:

- All Prisma migrations (including PuctRep and related tables) are applied into
  `intelliwatt_dev`.
- Local runs of the app that use this `DATABASE_URL` will see the full schema.

## 4. Important: keep prod and dev DBs separate

Do **not** set the dev DB connection string in:

- Vercel project settings (prod or preview),
- Droplet environment files (`/etc/default/intelliwatt-smt`),
- Any committed `.env` files.

The dev DB is for:

- Local development,
- Running `npx prisma migrate dev`,
- Testing admin features like `/api/admin/puct/reps` against a clean schema.

The DO production-like DB keeps its existing connection string and is managed via
careful, explicit Plan Changes and `prisma migrate resolve` when we are ready to
realign it.

## 5. Quick verification checklist

After setting up the dev DB and running `npx prisma migrate dev`:

- `npx prisma migrate dev` finishes with no errors.
- `npx prisma studio` (optional) shows the full Prisma schema, including `PuctRep`.
- Local runs of the Next.js app (pointed at the dev DB) can access any new
  tables (e.g., `PuctRep`) from admin routes without touching the DO cluster.

When in doubt, re-check `docs/PROJECT_PLAN.md` (PC-2025-11-22-B) before changing
any `DATABASE_URL` in a shared environment.

### Production-ish DB (DO `defaultdb`)

- DO Postgres `defaultdb` hosts live app data and historical manually-applied SMT/ERCOT schema changes.
- Do **not** run `npx prisma migrate dev` against `defaultdb`. Only `npx prisma migrate deploy` is allowed, and only from a controlled environment (droplet).
- If a migration fails on `defaultdb`, fix the SQL locally (idempotent guards, conditional renames), commit, then on the droplet:
  - `npx prisma migrate resolve --rolled-back <migration_name>`
  - `npx prisma migrate deploy`
  after clearing any connection-slot issues in the DO UI.

