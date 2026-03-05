# Migration: UsageShapeProfile (usage DB)

Usage DB only. Replace `YOUR_USAGE_DB_URL` (and `YOUR_USAGE_DIRECT_URL` if you use it) with your real URLs. Path: replace `/home/deploy/apps/intelliwatt` if your repo lives elsewhere.

---

## Check if table exists (droplet)

```bash
export USAGE_DATABASE_URL='YOUR_USAGE_DB_URL'
psql "$USAGE_DATABASE_URL" -t -c "SELECT to_regclass('public.\"UsageShapeProfile\"');"
```

Non-empty (e.g. `"UsageShapeProfile"` or a number) = exists. Empty = run migration below.

---

## Usage DEV — create table (droplet)

```bash
sudo -iu deploy
cd /home/deploy/apps/intelliwatt
git pull origin main

export USAGE_DATABASE_URL='YOUR_USAGE_DEV_URL'
export USAGE_DIRECT_URL='YOUR_USAGE_DEV_DIRECT_URL'

npx prisma migrate reset --force --schema prisma/usage/schema.prisma
npx prisma migrate deploy --schema prisma/usage/schema.prisma

psql "$USAGE_DATABASE_URL" -t -c "SELECT to_regclass('public.\"UsageShapeProfile\"');"
```

---

## Usage PROD — create table (droplet)

Snapshot usage PROD first. Then:

```bash
sudo -iu deploy
cd /home/deploy/apps/intelliwatt
git pull origin main

export USAGE_DATABASE_URL='YOUR_USAGE_PROD_URL'
export USAGE_DIRECT_URL='YOUR_USAGE_PROD_DIRECT_URL'

npx prisma db execute --schema prisma/usage/schema.prisma --file prisma/usage/migrations/20260227140000_add_usage_shape_profile/migration.sql

psql "$USAGE_DATABASE_URL" -t -c "SELECT to_regclass('public.\"UsageShapeProfile\"');"
```

Do not run `migrate reset` or `migrate dev` on PROD.

---

## Deploy code only (no DB change)

```bash
cd /home/deploy/apps/intelliwatt
git pull origin main
sudo bash deploy/droplet/post_pull.sh
```
