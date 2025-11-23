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

