# Migration: EV fields on Home Details (home-details DB)

EV (Electric Vehicle) is stored in **Home Details** (`HomeProfileSimulated`), not in the Appliance Profile. This migration adds the EV columns to the **home-details database**. Use the home-details schema and **HOME_DETAILS_DATABASE_URL**. Apply on home-details DEV first, then home-details PROD via direct SQL. All commands on the **droplet** use **bash**.

**Important:** The **main** app schema is `prisma/schema.prisma` (uses `DATABASE_URL`); the **home-details** schema is `prisma/home-details/schema.prisma` (uses `HOME_DETAILS_DATABASE_URL`). Never run `--schema=prisma/schema.prisma` against the home-details DB — that applies the main app’s migrations to the wrong database and causes **P3005** (database not empty).

---

## Step 0 — Migration in repo

The migration is already in the repo:

- `prisma/home-details/migrations/20260227200000_home_profile_ev_fields/migration.sql`

---

## Step A — Home-details DEV (on droplet)

**Where:** Droplet SSH. Switch to `deploy`, then run from repo root.

0. Become `deploy` and go to the repo:

   ```bash
   sudo -iu deploy
   cd /home/deploy/apps/intelliwatt
   pwd
   whoami
   ```

1. Pull latest code:

   ```bash
   git status -sb
   git pull origin main
   ```

2. Point env at **home-details DEV** for this shell (use your real home-details DEV URL; do not commit secrets):

   ```bash
   export HOME_DETAILS_DATABASE_URL='postgresql://...'
   ```

3. Reset home-details DEV and apply all home-details migrations:

   ```bash
   npx prisma migrate reset --force --schema prisma/home-details/schema.prisma
   npx prisma migrate deploy --schema prisma/home-details/schema.prisma
   ```

4. Verify:

   ```bash
   psql "$HOME_DETAILS_DATABASE_URL" -c '\d+ "HomeProfileSimulated"' | grep ev
   ```

   You should see columns: `evHasVehicle`, `evCount`, `evChargerType`, etc.

---

## Step B — Home-details PROD (on droplet)

**Pre-requisite:** Snapshot the home-details PROD database first.

0. Same as Step A: `sudo -iu deploy`, `cd /home/deploy/apps/intelliwatt`, `git pull origin main`.

1. Point env at **home-details PROD** for this shell:

   ```bash
   export HOME_DETAILS_DATABASE_URL='postgresql://...'
   ```

2. Execute the migration SQL on home-details PROD:

   ```bash
   npx prisma db execute --schema prisma/home-details/schema.prisma --file prisma/home-details/migrations/20260227200000_home_profile_ev_fields/migration.sql
   ```

3. Verify (see note if psql fails):

   ```bash
   psql "$HOME_DETAILS_DATABASE_URL" -c '\d+ "HomeProfileSimulated"' | grep ev
   ```

   If you see `psql: error: invalid URI query parameter: "pgbouncer"`, the URL has a driver-only query param. Use a URL without it for psql (e.g. same URL but drop `&pgbouncer=true` or `?pgbouncer=true`), or rely on **Script executed successfully** from step 2.

Do **not** run `prisma migrate reset` or `prisma migrate dev` on home-details PROD.

---

## Troubleshooting: P3005 or “47 migrations” against home-details

If you see **P3005** (“The database schema is not empty”) or a list of **47 migrations** (main app migrations) when you expected to work with the home-details DB, you are using the **wrong schema**.

- **Wrong:** `npx prisma migrate deploy --schema=prisma/schema.prisma` with `DATABASE_URL` pointing at `intelliwatt_home_details`. That runs the **main** app migrations against the home-details database.
- **Right for home-details:** Use the **home-details** schema and env:
  ```bash
  export HOME_DETAILS_DATABASE_URL='postgresql://...'   # your home-details DB URL
  npx prisma db execute --schema prisma/home-details/schema.prisma --file prisma/home-details/migrations/20260227200000_home_profile_ev_fields/migration.sql
  ```
- **Right for main app:** Use `DATABASE_URL` pointing at the **main** DB (e.g. `intelliwatt` or `intelliwatt_dev`) and `--schema prisma/schema.prisma` when you run main-app migrations.

For an **existing** home-details DB that already has tables, do **not** use `prisma migrate deploy` for home-details (it may try to baseline). Use **Step B** above: `prisma db execute` with the single migration file.

---

## Troubleshooting: psql "invalid URI query parameter: pgbouncer"

If `HOME_DETAILS_DATABASE_URL` (or `DATABASE_URL`) includes a query parameter like `?pgbouncer=true` or `&pgbouncer=true`, **psql** will reject it. Prisma and other drivers accept it for connection pooling; psql does not.

**Workaround for verification:** Use a copy of the URL without the pgbouncer param, e.g. in bash:

```bash
# Strip query string and re-add only sslmode so psql accepts the URL
export PSQL_URL="${HOME_DETAILS_DATABASE_URL%%\?*}"
psql "$PSQL_URL?sslmode=require" -c '\d+ "HomeProfileSimulated"' | grep ev
```

Or set a separate env var (e.g. `HOME_DETAILS_DIRECT_URL` or a manual URL) that has no pgbouncer param and use that for ad-hoc psql checks.

**Do not paste example URLs literally.** Placeholders like `user`, `pass`, `host` in docs must be replaced with your real database host (e.g. `db-postgresql-nyc3-...ondigitalocean.com`), username, and password.

---

## Pull to droplet (code only)

When you only need to deploy app code (no DB change):

```bash
cd /home/deploy/apps/intelliwatt
git pull origin main
sudo bash deploy/droplet/post_pull.sh
```

---

## Summary

| Step | Where   | Action |
|------|--------|--------|
| A    | Droplet (as `deploy`) | Pull, set home-details DEV env, `migrate reset` + `migrate deploy` with `--schema prisma/home-details/schema.prisma`, verify. |
| B    | Droplet (as `deploy`) | Snapshot home-details PROD, pull, set home-details PROD env, `prisma db execute --schema prisma/home-details/schema.prisma --file prisma/home-details/migrations/20260227200000_home_profile_ev_fields/migration.sql`, verify. |
| Deploy code | Droplet | `git pull origin main` then `sudo bash deploy/droplet/post_pull.sh`. |

**Database:** Home-details DB only. Use **HOME_DETAILS_DATABASE_URL**. Schema: `prisma/home-details/schema.prisma`; migrations: `prisma/home-details/migrations/`.

---

## Backward compatibility (app behavior)

- **On read:** If an appliance of type `"ev"` exists and `HomeProfileSimulated.evHasVehicle` is false, the loader migrates that appliance’s data into Home Details and persists it. Existing EV appliance rows are **not** deleted.
- **Simulator:** `hasEV` is derived from `homeProfile.ev?.hasVehicle === true` (or flat `evHasVehicle`). Appliance list is no longer used for EV presence.
- **UI:** Home Details has an "Electric Vehicle" section; Appliances no longer offers "Add EV Charger" (existing EV appliances remain visible).
