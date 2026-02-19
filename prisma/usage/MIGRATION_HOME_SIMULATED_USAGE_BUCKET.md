# Migration: HomeSimulatedUsageBucket (Past/Future usage buckets)

This adds the `HomeSimulatedUsageBucket` table to the **Usage module** database so Past and Future simulated usage buckets are stored separately for plan costing.

- **Schema**: `prisma/usage/schema.prisma`
- **Migrations dir**: `prisma/usage/migrations`
- **Env**: `USAGE_DATABASE_URL` and `USAGE_DIRECT_URL` (see schema datasource)

---

## 1. Prerequisites

- Usage DB reachable (e.g. `intelliwatt_usage`).
- In `.env` (or shell):
  - `USAGE_DATABASE_URL` — connection URL for the usage DB.
  - `USAGE_DIRECT_URL` — direct URL (e.g. for migrations); can match `USAGE_DATABASE_URL` if you don’t use a pooler.

---

## 2. Dev: create and apply the migration

From the **repo root**:

```bash
# Generate the Usage Prisma client
npx prisma generate --schema=prisma/usage/schema.prisma

# Create and apply the migration (creates migration SQL and applies it to the DB)
npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket
```

If Prisma says the schema is already in sync but you expect the new table, create the migration without applying, then apply:

```bash
npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket --create-only
npx prisma migrate dev --schema=prisma/usage/schema.prisma
```

---

## 3. PowerShell (Windows)

From the project docs (e.g. `docs/PROJECT_PLAN.md` “PowerShell runbook — Module Prisma CLI”):

1. **Optional**: stop any stuck Prisma/Node and relax execution policy:
   ```powershell
   Get-Process prisma, node -ErrorAction SilentlyContinue | Stop-Process
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```

2. **Set the Usage DB URLs** (replace with your values):
   ```powershell
   $env:USAGE_DATABASE_URL = "postgresql://user:pass@host:port/intelliwatt_usage?sslmode=require"
   $env:USAGE_DIRECT_URL   = "postgresql://user:pass@host:port/intelliwatt_usage?sslmode=require"
   ```

3. **Generate and migrate**:
   ```powershell
   npx prisma generate --schema=prisma/usage/schema.prisma
   npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_home_simulated_usage_bucket
   ```

---

## 4. Production / staging deploy

After the migration is committed and you’re ready to update staging/production:

```bash
npx prisma migrate deploy --schema=prisma/usage/schema.prisma
```

Ensure `USAGE_DATABASE_URL` and `USAGE_DIRECT_URL` are set in the target environment.

---

## 5. Verify

- **Status**:
  ```bash
  npx prisma migrate status --schema=prisma/usage/schema.prisma
  ```
- **Tables**: In the usage DB, confirm `HomeSimulatedUsageBucket` exists and has the expected columns and unique constraint `(homeId, scenarioKey, yearMonth, bucketKey)`.

---

## 6. Notes (from project conventions)

- Usage migrations are **isolated** from the main app schema; do not put main-schema migrations in `prisma/usage/migrations`.
- Always use the **usage schema** for this module: `--schema=prisma/usage/schema.prisma`.
- The schema comment also references `--migrations-dir=prisma/usage/migrations`; `migrate dev` will use the migrations directory configured in the schema when you pass `--schema`.
