# Migration: PastSimulatedDatasetCache (usage DB)

Adds the **PastSimulatedDatasetCache** table to the **usage** database (not the main DB). Use the usage schema and **USAGE_DATABASE_URL**. Same DB as UsageShapeProfile and simulated usage buckets. Apply on **usage DEV first**, then **usage PROD** via direct SQL. All commands on the **droplet** use **bash** from the repo checkout.

**Reference:** Usage DB workflow matches `docs/MIGRATION_USAGE_SHAPE_PROFILE.md`. Do **not** run `prisma migrate reset` or `prisma migrate dev` on PROD.

---

## Step 0 — Migration in repo

The migration is in the repo:

- `prisma/usage/migrations/20260228000000_add_past_simulated_dataset_cache/migration.sql`
- Model: `PastSimulatedDatasetCache` in `prisma/usage/schema.prisma`

If you previously had this migration under the **main** schema, remove the empty folder `prisma/migrations/20260228000000_add_past_simulated_dataset_cache` (if it still exists) so main-schema migrate commands don’t fail.

---

## Step A — Usage DEV (on droplet)

**Where:** Droplet SSH. Switch to `deploy`, then run from repo root.

0. Become `deploy` and go to the repo:

   ```bash
   sudo -iu deploy
   cd /home/deploy/apps/intelliwatt
   pwd
   whoami
   ```

   Expected: `pwd` → `/home/deploy/apps/intelliwatt`, `whoami` → `deploy`

1. Pull latest code (so migrations are present):

   ```bash
   git status -sb
   git pull origin main
   ```

2. Point env at **usage DEV** for this shell only (do not commit secrets):

   ```bash
   export USAGE_DATABASE_URL='postgresql://...intelliwatt_usage?sslmode=require'
   export USAGE_DIRECT_URL='postgresql://...intelliwatt_usage?sslmode=require'
   ```

3. Reset usage DEV and apply all usage migrations:

   ```bash
   npx prisma migrate reset --force --schema prisma/usage/schema.prisma
   npx prisma migrate deploy --schema prisma/usage/schema.prisma
   ```

4. Verify the new table:

   ```bash
   psql "$USAGE_DATABASE_URL" -c 'SELECT current_database() AS db, to_regclass('"'"'public."PastSimulatedDatasetCache"'"'"') AS table_name;'
   psql "$USAGE_DATABASE_URL" -c '\d+ "PastSimulatedDatasetCache"'
   ```

   Expected: `table_name` is `PastSimulatedDatasetCache` (not null); `\d+` shows columns, indexes, and constraints.

---

## Step B — Usage PROD (on droplet)

**Pre-req:** Snapshot the **usage** PROD database first (MANDATORY).

**Where:** Droplet SSH. Switch to `deploy`, repo root.

0. Become `deploy` and go to the repo:

   ```bash
   sudo -iu deploy
   cd /home/deploy/apps/intelliwatt
   pwd
   whoami
   ```

1. Pull latest code (so the migration file exists):

   ```bash
   git status -sb
   git pull origin main
   ```

2. Point env at **usage PROD** for this shell only:

   ```bash
   export USAGE_DATABASE_URL='postgresql://...intelliwatt_usage?sslmode=require'
   export USAGE_DIRECT_URL='postgresql://...intelliwatt_usage?sslmode=require'
   ```

   (Use your actual usage PROD connection string; database name is typically `intelliwatt_usage`.)

3. Execute the migration SQL on usage PROD:

   ```bash
   npx prisma db execute --schema prisma/usage/schema.prisma --file prisma/usage/migrations/20260228000000_add_past_simulated_dataset_cache/migration.sql
   ```

4. Verify:

   ```bash
   psql "$USAGE_DATABASE_URL" -c 'SELECT current_database() AS db, to_regclass('"'"'public."PastSimulatedDatasetCache"'"'"') AS table_name;'
   psql "$USAGE_DATABASE_URL" -c '\d+ "PastSimulatedDatasetCache"'
   ```

   Expected: `table_name` is `PastSimulatedDatasetCache` (not null).

---

## After migration

- **Vercel:** Ensure **USAGE_DATABASE_URL** (and **USAGE_DIRECT_URL** if used) are set for the app so the usage client and Past cache work.
- **Prisma client:** Run `npx prisma generate --schema prisma/usage/schema.prisma` so the usage client includes `pastSimulatedDatasetCache`. Builds (Vercel, droplet) typically run generate for all schemas; no need to run it on Windows before commit.
- **Droplet:** No `post_pull.sh` required for this migration. After applying the usage PROD migration, a normal `git pull` is enough.

---

## Prisma generate (EPERM on Windows)

The migration **SQL** does not require `prisma generate` to run. Applying the migration (Step A/B) only runs raw SQL. The **application** needs the generated usage client that includes `PastSimulatedDatasetCache`:

- **Vercel:** The build runs `prisma generate` (or your generate-all script) in a clean environment — no Windows file lock. After you push, the next deploy will generate the usage client and the cache will work.
- **Droplet:** When you pull and build/run the app there, generate runs on Linux — no EPERM.
- **Local Windows:** If you hit EPERM, close any process using the generated client (e.g. dev server, IDE), then run `npx prisma generate --schema prisma/usage/schema.prisma`. Committing and pushing does **not** depend on local generate; the migration will work once the usage migration is applied and the app (Vercel/droplet) has generated the client.

---

## Hard rules

- Do **not** run `npx prisma migrate reset` on usage PROD (ever).
- Do **not** run `npx prisma migrate dev` on usage PROD (ever).
- Usage PROD gets the migration via `prisma db execute --file ...` only, after usage DEV has been proven clean.
- Use **USAGE_DATABASE_URL** / **USAGE_DIRECT_URL** for this migration, not **DATABASE_URL** (main DB).
- Do **not** paste Windows paths into droplet bash; use Linux paths (`prisma/usage/schema.prisma`, etc.).
- Run all `npx prisma` commands from the repo root (`/home/deploy/apps/intelliwatt`).
