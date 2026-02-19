# Migration: HomeSimulatedUsageBucket (Past/Future usage buckets)

This adds the `HomeSimulatedUsageBucket` table to the **Usage module** database so Past and Future simulated usage buckets are stored separately for plan costing.

- **Schema**: `prisma/usage/schema.prisma`
- **Migrations dir**: `prisma/usage/migrations`
- **Env**: `USAGE_DATABASE_URL`, `USAGE_DIRECT_URL` (usage DB; db name e.g. `intelliwatt_usage`)

---

## 1. Local / dev: set env and create migration

From the **repo root**. Set the usage DB URL (include the **db name** in the path, e.g. `intelliwatt_usage`).

**Bash (Linux / macOS / Git Bash):**
```bash
export USAGE_DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"
export USAGE_DIRECT_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"
```

**PowerShell (Windows):**
```powershell
$env:USAGE_DATABASE_URL = "postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"
$env:USAGE_DIRECT_URL   = "postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"
```

Then generate and create/apply the migration:
```bash
npx prisma generate --schema=prisma/usage/schema.prisma
npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket
```

If Prisma says “Already in sync” but you expect the new table:
```bash
npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket --create-only
npx prisma migrate dev --schema=prisma/usage/schema.prisma
```

---

## 2. Deploy (staging / production)

Get to your deploy environment (e.g. droplet or CI), then **export the usage DB name and URLs** and run migrate deploy.

**Bash (e.g. on droplet):**
```bash
cd /home/deploy/apps/intelliwatt
git pull origin main
npm install

export USAGE_DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"
export USAGE_DIRECT_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_usage?sslmode=require"

npx prisma migrate deploy --schema=prisma/usage/schema.prisma
npx prisma migrate status --schema=prisma/usage/schema.prisma
```

Replace `<db_user>`, `<db_password>`, `<db_host>`, `<db_port>` with your cluster values. The **database name** must be the usage DB (e.g. `intelliwatt_usage`); do not use the main app DB name.

---

## 3. Copy-paste (fill placeholders once)

**Local dev – set env then migrate:**
```bash
export USAGE_DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/intelliwatt_usage?sslmode=require"
export USAGE_DIRECT_URL="postgresql://<user>:<pass>@<host>:<port>/intelliwatt_usage?sslmode=require"
npx prisma generate --schema=prisma/usage/schema.prisma
npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket
```

**Deploy – set env then deploy:**
```bash
export USAGE_DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/intelliwatt_usage?sslmode=require"
export USAGE_DIRECT_URL="postgresql://<user>:<pass>@<host>:<port>/intelliwatt_usage?sslmode=require"
npx prisma migrate deploy --schema=prisma/usage/schema.prisma
```

**Verify:**
```bash
npx prisma migrate status --schema=prisma/usage/schema.prisma
```

---

## 4. Notes

- Usage migrations are **isolated** from the main app schema; do not put main-schema migrations in `prisma/usage/migrations`.
- Always use **usage schema**: `--schema=prisma/usage/schema.prisma`.
- You must **export** (or set) both `USAGE_DATABASE_URL` and `USAGE_DIRECT_URL` with the **correct db name** (e.g. `intelliwatt_usage`) before running generate or migrate; Prisma will fail if these env vars are missing.
