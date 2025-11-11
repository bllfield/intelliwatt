# OPS: ERCOT Daily Ingest & DB Explorer — Checklist

## Daily Cron (Vercel)

- Scheduled in `vercel.json`: `0 12 * * *` (12:00 UTC → 6:00 AM CST / 7:00 AM CDT)
- Path: `/api/admin/ercot/cron` (Vercel sets `x-vercel-cron` header automatically)

## Environment Variables (Production)

- `ERCOT_PAGE_URL=https://www.ercot.com/mp/data-products/data-product-details?id=ZP15-612`
- `CRON_SECRET=<long-random>`
- `S3_ENDPOINT=https://<region>.digitaloceanspaces.com` (e.g., `https://nyc3.digitaloceanspaces.com`)
- `S3_REGION=<region>` (e.g., `nyc3`)
- `S3_BUCKET=<space-name>` (lowercase)
- `S3_ACCESS_KEY_ID=<Spaces Access Key>`
- `S3_SECRET_ACCESS_KEY=<Spaces Secret Key>`
- `S3_FORCE_PATH_STYLE=true` (recommended for DigitalOcean Spaces)

## Health Check (no download)

- **Managed cron style:**  
  `curl -sS -H "x-vercel-cron: 1" https://<domain>/api/admin/ercot/cron/health | jq`

- **Manual style:**  
  `curl -sS "https://<domain>/api/admin/ercot/cron/health?token=$CRON_SECRET" | jq`

- Expect: `{ ok: true, missing: [] }` if everything is set

## Manual Run (download + upload)

- **Token mode:**  
  `curl -sS "https://<domain>/api/admin/ercot/cron?token=$CRON_SECRET" | jq`

- Expect: `{ ok: true, results: [...] }`, each TDSP => `{ key, bytes }` or `{ skipped: true }`

## Verify

- **Storage:** Objects at `ercot/YYYY-MM-DD/<filename>.zip` in your Space
- **DB:** `/admin/database` → table **ErcotIngest** shows new rows (filename, storageKey, sizeBytes, sourceUrl, status)

## Notes

- Vercel cron uses UTC.
- If ERCOT markup changes, update selectors in `lib/ercot/fetchDaily.ts`.
- For large-file timeouts: split TDSPs into separate invocations or run the job on your droplet.

