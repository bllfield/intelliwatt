# ERCOT Daily Pull System — Complete Guide

**Last Updated**: November 2025

This guide covers deployment, migration, testing, and troubleshooting for the ERCOT daily pull system.

---

## Overview

The ERCOT system automatically ingests daily TDSP ESIID Extract files from ERCOT, normalizes the data, and stores it in `ErcotEsiidIndex` for ESIID lookups. The system includes:

- **Prisma Models**: `ErcotIngest` (ingestion history) and `ErcotEsiidIndex` (normalized ESIID data)
- **Library Functions**: URL resolution, file fetching, data ingestion
- **API Routes**: Cron endpoint, manual fetch, ingest history, ESIID lookup
- **Vercel Cron**: Multiple daily runs (15 9 * * *, 30 10 * * 3, 0 15 * * *)

---

## Prerequisites

1. **Database URL configured**: Set `DATABASE_URL` in your environment
2. **Prisma CLI installed**: `npm install` should have installed it
3. **Database access**: Ensure you can connect to your database

---

## Step 1: Database Migration

### For Production

```bash
npx prisma migrate deploy
```

This will:
- Apply all pending migrations to production
- **Does NOT** create new migration files (use `migrate dev` for that)
- Safe to run multiple times (idempotent)

### For Development

```bash
npx prisma migrate dev --name add_ercot_models
```

This will:
- Create a new migration file
- Apply it to your development database
- Regenerate Prisma Client

### Verify Migration

After running the migration, verify the tables were created:

```bash
npx prisma studio
```

Or check via SQL:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('ErcotIngest', 'ErcotEsiidIndex');
```

### Expected Tables

After migration, you should have:

1. **ErcotIngest** - Tracks ingestion history
   - `id`, `createdAt`
   - `status` ("ok" | "skipped" | "error")
   - `note`, `fileUrl`, `fileSha256` (unique)
   - `tdsp`, `rowCount`
   - `headers` (JSON), `error`, `errorDetail`

2. **ErcotEsiidIndex** - Stores ESIID data
   - `id`, `createdAt`, `updatedAt`
   - `esiid` (unique, 17-18 digits)
   - `tdsp`, `serviceAddress1`, `city`, `state`, `zip`
   - `raw` (JSON), `srcFileSha256`

---

## Step 2: Environment Variables

**Required** (Vercel → Settings → Environment Variables, Production):

- `DATABASE_URL` - Database connection string
- `ADMIN_TOKEN` - Admin route authentication
- `CRON_SECRET` - Cron endpoint authentication
- `ERCOT_PAGE_URL` - ERCOT data product page URL (e.g., `https://www.ercot.com/mp/data-products/data-product-details?id=ZP15-612`)

**Optional**:

- `PROD_BASE_URL` - Production base URL (default: `https://intelliwatt.com`)
- `ERCOT_PAGE_FILTER` - Filter for file links (e.g., `TDSP`)
- `ERCOT_USER_AGENT` - Custom user agent string
- `ERCOT_TEST_URL` - Explicit file URL for manual testing

---

## Step 3: Deploy to Vercel

1. **Deploy main branch** → Vercel automatically builds and deploys
2. **Verify cron exists** in Vercel Dashboard → Settings → Cron Jobs
   - Should see 3 schedules: `15 9 * * *`, `30 10 * * 3`, `0 15 * * *`
   - Path: `/api/admin/ercot/cron`

---

## Step 4: Verify Deployment

### Basic Health Check

```bash
export PROD_BASE_URL="https://intelliwatt.com"
export ADMIN_TOKEN="<your-admin-token>"

# Verify env health
curl -sS "$PROD_BASE_URL/api/admin/env-health" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Test URL resolution
curl -sS "$PROD_BASE_URL/api/admin/ercot/debug/url-sanity" -H "x-admin-token: $ADMIN_TOKEN" | jq
```

### Test Endpoints

```bash
# List recent ingests (should return 200 OK, may be empty array)
curl -sS "$PROD_BASE_URL/api/admin/ercot/ingests?limit=10" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Get last ingest record (may return null if no ingests)
curl -sS "$PROD_BASE_URL/api/admin/ercot/debug/last" -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected results after migration:**
- ✅ Ingests: 200 OK (may return empty array if no data yet)
- ✅ Debug Last: 200 OK (may return null if no ingests)
- ✅ URL Sanity: 200 OK (may show no candidates if page structure changed)

---

## Step 5: Manual Operations

### Manual File Fetch

If you have a direct file URL:

```bash
export ERCOT_TEST_URL="https://mdt.ercot.com/public/tdsp/TDSP_ESIID_Extract_2025-11-07.txt"
npm run ercot:fetch:latest
```

Or via API:

```bash
curl -sS "$PROD_BASE_URL/api/admin/ercot/fetch-latest?url=<file_url>&notes=manual" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

### Trigger Cron Manually

```bash
export CRON_SECRET="<your-cron-secret>"

# Using query parameter
curl -sS "$PROD_BASE_URL/api/admin/ercot/cron?token=$CRON_SECRET" | jq

# Or using header
curl -sS "$PROD_BASE_URL/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET" | jq
```

Or use the npm script:

```bash
npm run ercot:resolve:fetch
```

### ESIID Lookup

```bash
curl -sS -X POST "$PROD_BASE_URL/api/admin/ercot/lookup-esiid" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"line1":"9514 Santa Paula Dr","city":"Fort Worth","state":"TX","zip":"76116"}' | jq
```

---

## Troubleshooting

### Migration Issues

**Error: "Environment variable not found: DATABASE_URL"**

Set `DATABASE_URL` in your environment:
```bash
export DATABASE_URL="postgresql://user:password@host:port/database"
```

**Error: "Migration failed"**

- Check database connection
- Ensure you have write permissions
- Review migration SQL in `prisma/migrations/` folder

**Rollback (if needed)**

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

### Runtime Issues

**500 errors after migration:**

1. Check Vercel function logs for detailed error messages
2. Verify `DATABASE_URL` is correct
3. Ensure Prisma Client is generated: `npx prisma generate`
4. Check that the database connection is working

**URL Sanity returns no candidates:**

- The ERCOT page structure may have changed
- Links may require JavaScript rendering (JSDOM doesn't execute JS)
- Try a different page URL or adjust the filter
- Check ERCOT documentation for the actual file location

**Cron returns "NO_CANDIDATES":**

- This is expected if the ERCOT page doesn't have direct download links
- The page may require JavaScript to render links
- Consider using a direct file URL pattern or different page URL
- For testing, use `ERCOT_TEST_URL` with manual fetch

### Common Issues

- **Files not found**: ERCOT page structure may have changed; check `ERCOT_PAGE_URL`
- **Duplicate ingestion**: System uses SHA256 hashing for idempotence; already-processed files are skipped
- **Slow ingestion**: Large files are processed in batches (1000 records per batch)

---

## System Architecture

### Idempotence

- Files are deduplicated by SHA256 hash
- Re-ingestion of the same file is skipped (status: "skipped")
- Batch upserts for efficient database writes

### Data Flow

1. **Cron triggers** → `/api/admin/ercot/cron`
2. **URL resolution** → `resolveLatestFromPage()` finds latest file link
3. **File fetch** → `fetchToTmp()` downloads to `/tmp`, computes SHA256
4. **Check existing** → Query `ErcotIngest` by `fileSha256`
5. **Parse & ingest** → `ingestLocalFile()` extracts ESIIDs, batch upserts
6. **Record history** → Create/update `ErcotIngest` record

### Admin UI

Navigate to `/admin/ercot/inspector` for interactive testing:
- View ingest history
- Test URL resolution
- Lookup ESIID from address
- Requires `ADMIN_TOKEN` for authentication

---

## Related Documentation

- **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** - ERCOT system architecture (PC-2025-11-10)
- **[QUICK_START.md](./QUICK_START.md)** - Quick ERCOT commands reference
- **[TESTING_API.md](./TESTING_API.md)** - API testing guide
- **[ENV_VARS.md](./ENV_VARS.md)** - Environment variables reference

[2025-11-12] Pause ERCOT ESIID Indexing (Ops Checklist)

Goal: keep ERCOT code intact but ensure it does not run while WattBuy is the ESIID source.

Vercel (UI):

1) Settings → Environment Variables:

   - Add or set:

     - `ESIID_SOURCE = wattbuy`

     - `WATTBUY_ESIID_ENABLED = true`

     - `ERCOT_ESIID_DISABLED = true`

   - Redeploy to apply.

2) Settings → Cron Jobs:

   - Remove or disable any cron that calls `/api/admin/ercot/cron` or related ERCOT ESIID tasks.

   - If you keep the route for manual smoke tests, leave it undocumented while paused.

Droplet (if any ERCOT timers exist):

- If a systemd timer was created for ERCOT ESIID (rare):

  ```
  sudo systemctl disable --now ercot-esid.timer || true
  sudo systemctl stop ercot-esid.service || true
  ```

- Document the pause in ops notes and reference this section.

Re-enable later:

- Flip envs:

- `ESIID_SOURCE=ercot`, unset `ERCOT_ESIID_DISABLED`, and (optionally) set `WATTBUY_ESIID_ENABLED=false`.

- Recreate/enable cron and timers per the standard ERCOT section above.

