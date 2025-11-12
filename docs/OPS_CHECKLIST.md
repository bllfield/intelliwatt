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
- `ERCOT_SCOPE` — defaults to `openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access` (space-separated)
- `ERCOT_PRODUCT_ID` — defaults to `ZP15-612`

The cron will request a fresh `id_token` every run and use:
- `Ocp-Apim-Subscription-Key: <subscription key>`
- `Authorization: Bearer <id_token>`

**Note:** If `ERCOT_SUBSCRIPTION_KEY` is not set, the system falls back to HTML scraping (less reliable).

## ERCOT EWS (mutual-TLS) credentials (preferred method)

Set these in Vercel (Production) to use ERCOT EWS (mutual-TLS authentication):

- `ERCOT_EWS_BASE` — EWS service base URL (e.g., `https://ews.ercot.com`)
- `ERCOT_EWS_REPORTTYPE` — Report type ID (default: `203` for TDSP ESIID Extract)

**Option 1: PFX certificate (recommended)**
- `ERCOT_EWS_PFX` — Base64-encoded PKCS#12 (.pfx) file containing client certificate and private key
- `ERCOT_EWS_PFX_PASS` — Password for the PFX file (if required)

**Option 2: PEM certificate and key**
- `ERCOT_EWS_CERT` — PEM-encoded client certificate (include newlines with `\n` or copy-paste full certificate)
- `ERCOT_EWS_KEY` — PEM-encoded private key (include newlines with `\n` or copy-paste full key)
- `ERCOT_EWS_CA` — Optional: PEM-encoded CA certificate chain (if required by ERCOT)

**How to get ERCOT EWS credentials:**
1. Contact ERCOT to request EWS access and obtain client certificate
2. Convert certificate to PFX format (if needed): `openssl pkcs12 -export -out cert.pfx -inkey key.pem -in cert.pem`
3. Encode PFX to base64: `base64 -i cert.pfx` (or `cat cert.pfx | base64`)
4. Set `ERCOT_EWS_PFX` to the base64 string and `ERCOT_EWS_PFX_PASS` to the password

**Priority order:**
1. EWS (if `ERCOT_EWS_BASE` and certificate configured) — **preferred**
2. ERCOT Public API (if `ERCOT_SUBSCRIPTION_KEY` configured)
3. HTML scraping (fallback)

## Notes

- Vercel cron uses UTC.
- If ERCOT markup changes, update selectors in `lib/ercot/fetchDaily.ts`.
- For large-file timeouts: split TDSPs into separate invocations or run the job on your droplet.
- When using ERCOT Public API, tokens expire ~1 hour; a fresh token is requested on each cron run.
- EWS uses mutual-TLS authentication and requires a valid client certificate from ERCOT.

### SMT Inline Upload Guardrails

- **Body size:** Next.js no longer allows overriding App Router body-parser size in `next.config.js`; keep inline payloads small (≈4 MB) or upload via the droplet webhook for larger files.
- **Storage envs:** Ensure Spaces/S3 envs (`