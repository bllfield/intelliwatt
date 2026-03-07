# Migration: WeatherHourly (main DB)

Adds the **WeatherHourly** table to the **main** application database. Uses **prisma/schema.prisma** and **DATABASE_URL**. Open-Meteo hourly weather cache keyed by bucketed coordinates (0.1°); shared across homes for simulator, HVAC, and solar modeling.

Apply on **dev DB first**, then **defaultdb** (production). All commands on the **droplet** use **bash** from the repo checkout.

**Reference:** Main-schema workflow matches `docs/OPS_CHECKLIST.md` (Canonical: apply master Prisma migrations). Do **not** run `prisma migrate reset` on production (`defaultdb`).

---

## Which DB

- **Schema:** `prisma/schema.prisma` (main app schema).
- **Env:** `DATABASE_URL` — primary IntelliWatt application database (e.g. `intelliwatt_dev` for dev, `defaultdb` for production on DigitalOcean).
- **Not** a module DB: do **not** use `USAGE_DATABASE_URL`, `HOME_DETAILS_DATABASE_URL`, etc.

---

## Step 0 — Migration in repo

- `prisma/migrations/20260305000000_add_weather_hourly/migration.sql`
- Model: `WeatherHourly` in `prisma/schema.prisma`

---

## Step A — Main DEV (on droplet)

**Where:** Droplet SSH. Switch to `deploy`, then run from repo root.

0. Become `deploy` and go to the repo:

   ```bash
   sudo -iu deploy
   cd /home/deploy/apps/intelliwatt
   pwd
   whoami
   ```

   Expected: `pwd` → `/home/deploy/apps/intelliwatt`, `whoami` → `deploy`

1. Pull latest code (so the migration is present):

   ```bash
   git status -sb
   git pull origin main
   ```

2. Install deps (so `npx prisma` uses the pinned repo version):

   ```bash
   npm install
   ```

3. Point env at **main dev DB** for this shell only (do not commit secrets):

   ```bash
   export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_dev?sslmode=require"
   ```

4. Apply migrations to dev:

   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prisma
   npx prisma migrate status --schema=prisma/schema.prisma
   ```

5. Verify the new table (optional):

   ```bash
   psql "$DATABASE_URL" -c 'SELECT current_database() AS db, to_regclass('"'"'public."WeatherHourly"'"'"') AS table_name;'
   psql "$DATABASE_URL" -c '\d+ "WeatherHourly"'
   ```

   Expected: `table_name` is `WeatherHourly` (not null); `\d+` shows columns and index.

---

## Step B — Main PROD / defaultdb (on droplet)

**Pre-req:** Apply to dev first and confirm no errors. Optionally snapshot the main PROD database.

**Where:** Droplet SSH. Same repo root as Step A.

1. Point env at **main production DB** (`defaultdb`) for this shell only:

   ```bash
   export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/defaultdb?sslmode=require"
   ```

2. Apply migrations:

   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prisma
   npx prisma migrate status --schema=prisma/schema.prisma
   ```

3. Verify (optional):

   ```bash
   psql "$DATABASE_URL" -c 'SELECT current_database() AS db, to_regclass('"'"'public."WeatherHourly"'"'"') AS table_name;'
   ```

---

## After migration

- **Vercel:** Uses the same `DATABASE_URL`; no extra env. Next deploy will use the new table once Prisma client is generated (`prisma:generate-all` in build).
- **Droplet:** No extra env. Normal `git pull` and app restart; `post_pull.sh` (if any) typically runs `prisma generate` / build.

---

## Hard rules

- Use **DATABASE_URL** only (main DB). Do **not** use `USAGE_DATABASE_URL` or other module DBs for this migration.
- Do **not** run `npx prisma migrate reset` on production (`defaultdb`).
- Run all `npx prisma` commands from the repo root (`/home/deploy/apps/intelliwatt`).
- Use Linux paths in droplet bash (`prisma/schema.prisma`), not Windows paths.
