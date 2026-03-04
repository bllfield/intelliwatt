# Migration: UsageShapeProfile (usage DB)

`UsageShapeProfile` lives in the **usage database** (not the main DB). Use the usage schema and **USAGE_DATABASE_URL** for this migration. Apply on usage DEV first, then usage PROD via direct SQL. All commands that run on the **droplet** use **bash**.

---

## Step 0 — Create migration (optional)

The migration is already in the repo:

- `prisma/usage/migrations/20260227140000_add_usage_shape_profile/migration.sql`

To regenerate (repo root, with `USAGE_DATABASE_URL` set to usage dev):

```powershell
npx prisma migrate dev --name add_usage_shape_profile --schema prisma/usage/schema.prisma
```

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

1. Pull latest code:

   ```bash
   git status -sb
   git pull origin main
   ```

2. Point env at **usage DEV** for this shell (use your real usage DEV URL; do not commit secrets):

   ```bash
   export USAGE_DATABASE_URL='postgresql://...'
   export USAGE_DIRECT_URL='postgresql://...'
   ```

3. Reset usage DEV and apply all usage migrations:

   ```bash
   npx prisma migrate reset --force --schema prisma/usage/schema.prisma
   npx prisma migrate deploy --schema prisma/usage/schema.prisma
   ```

4. Verify:

   ```bash
   psql "$USAGE_DATABASE_URL" -c 'SELECT to_regclass('"'"'public."UsageShapeProfile"'"'"') AS table_name;'
   psql "$USAGE_DATABASE_URL" -c '\d+ "UsageShapeProfile"'
   ```

---

## Step B — Usage PROD (on droplet)

**Pre-requisite:** Snapshot the usage PROD database first.

0. Same as Step A: `sudo -iu deploy`, `cd /home/deploy/apps/intelliwatt`, `git pull origin main`.

1. Point env at **usage PROD** for this shell:

   ```bash
   export USAGE_DATABASE_URL='postgresql://...'
   export USAGE_DIRECT_URL='postgresql://...'
   ```

2. Execute the migration SQL on usage PROD:

   ```bash
   npx prisma db execute --schema prisma/usage/schema.prisma --file prisma/usage/migrations/20260227140000_add_usage_shape_profile/migration.sql
   ```

3. Verify:

   ```bash
   psql "$USAGE_DATABASE_URL" -c 'SELECT to_regclass('"'"'public."UsageShapeProfile"'"'"') AS table_name;'
   psql "$USAGE_DATABASE_URL" -c '\d+ "UsageShapeProfile"'
   ```

Do **not** run `prisma migrate reset` or `prisma migrate dev` on usage PROD.

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
| 0    | Local  | Optional: `npx prisma migrate dev --name add_usage_shape_profile --schema prisma/usage/schema.prisma`. Migration SQL is already in repo. |
| A    | Droplet (as `deploy`) | Pull, set usage DEV env, `migrate reset` + `migrate deploy` with `--schema prisma/usage/schema.prisma`, verify. |
| B    | Droplet (as `deploy`) | Snapshot usage PROD, pull, set usage PROD env, `prisma db execute --schema prisma/usage/schema.prisma --file prisma/usage/migrations/20260227140000_add_usage_shape_profile/migration.sql`, verify. |
| Deploy code | Droplet | `git pull origin main` then `sudo bash deploy/droplet/post_pull.sh`. |

**Database:** Usage DB only. Use **USAGE_DATABASE_URL** / **USAGE_DIRECT_URL**, not **DATABASE_URL**. Schema: `prisma/usage/schema.prisma`; migrations: `prisma/usage/migrations/`.
