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

## ERCOT Public API credentials (auto-ID token)

Set these in Vercel (Production) to use the ERCOT Public Data API (recommended):

- `ERCOT_SUBSCRIPTION_KEY` — from API Explorer → Products → Subscribe → Profile → Show Primary key
- `ERCOT_USERNAME` — your ERCOT API Explorer username (email)
- `ERCOT_PASSWORD` — your ERCOT API Explorer password

*(Optional overrides; defaults already match ERCOT docs)*

- `ERCOT_TOKEN_URL` — ERCOT B2C token endpoint
- `ERCOT_CLIENT_ID` — defaults to `fec253ea-0d06-4272-a5e6-b478baeecd70`
- `ERCOT_SCOPE` — defaults to `openid+fec253ea-0d06-4272-a5e6-b478baeecd70+offline_access`
- `ERCOT_PRODUCT_ID` — defaults to `ZP15-612`

The cron will request a fresh `id_token` every run and use:
- `Ocp-Apim-Subscription-Key: <subscription key>`
- `Authorization: Bearer <id_token>`

**Note:** If `ERCOT_SUBSCRIPTION_KEY` is not set, the system falls back to HTML scraping (less reliable).

## Notes

- Vercel cron uses UTC.
- If ERCOT markup changes, update selectors in `lib/ercot/fetchDaily.ts`.
- For large-file timeouts: split TDSPs into separate invocations or run the job on your droplet.
- When using ERCOT Public API, tokens expire ~1 hour; a fresh token is requested on each cron run.

