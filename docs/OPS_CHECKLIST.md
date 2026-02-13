## SMT · Admin Tools & Usage Normalization (Internal Only)

### Preconditions
- `ADMIN_TOKEN` is set in the Vercel environment and known only to operators.
- Droplet SMT proxy is healthy (`smt-webhook.service` running, JWT token test works).

### Schedule SMT Agreement Status Cron (Vercel)
1. Add a managed cron job in Vercel (Project → Settings → Cron Jobs) or via `vercel.json`.
2. Use an hourly cadence (e.g., `0 * * * *`) pointing to:
   - Path: `POST /api/admin/smt/cron/status`
   - Header: `x-admin-token: $ADMIN_TOKEN`
   - Optional body (JSON) to widen scope:
     ```json
     { "status": "ALL", "limit": 100 }
     ```
3. Cron invokes `refreshSmtAuthorizationStatus()` for each row it scans, pulling the latest SMT status and updating `smtAgreementId`, `smtStatus`, and `smtStatusMessage`.
4. Monitor Vercel function logs for `{ scanned, updated, failed }` to confirm the cron is running cleanly.

### Check SMT Agreement / Subscription Status
1. From a secure terminal (PowerShell or HTTP client), call:
   - URL: `POST https://intelliwatt.com/api/admin/smt/agreements/status`
   - Headers: `x-admin-token: $ADMIN_TOKEN`
   - Body:
     ```json
     { "esiid": "<ESIID>" }
     ```
2. Inspect `status` payload returned from droplet/SMT to confirm:
   - Agreement active / pending / terminated.
   - Subscription status (if present).

### Cancel SMT Agreement + Subscription (User Requests Disconnect)
1. Confirm user identity and document their request (ticket).
2. Call:
   - URL: `POST /api/admin/smt/agreements/cancel`
   - Body:
     ```json
     { "esiid": "<ESIID>" }
     ```
3. Verify response:
   - `ok: true` and droplet/SMT statusCode indicates success (or already-terminated).
4. Log the action in the user’s record (include timestamp and ESID).

### List SMT Subscriptions (CSP-wide)
1. Call:
   - URL: `POST /api/admin/smt/subscriptions/list`
   - Body (optional):
     ```json
     { "serviceType": "SUBSCRIPTION" }
     ```
2. Use results to troubleshoot duplicate or stale subscriptions before creating new ones.

### Agreement ESIIDs, Terminate Agreement, and MyAgreements
- **List ESIIDs for an Agreement**  
  - `POST /api/admin/smt/agreements/esiids` with `{ "agreementNumber": <number> }`.
- **Terminate a specific Agreement**  
  - `POST /api/admin/smt/agreements/terminate` with:
    ```json
    {
      "agreementNumber": <number>,
      "retailCustomerEmail": "customer@example.com"
    }
    ```
- **List / filter CSP Agreements**  
  - `POST /api/admin/smt/agreements/myagreements` with optional:
    ```json
    {
      "agreementNumber": <number>,
      "statusReason": "PEN" | "ACT" | "COM" | "NACOM"
    }
    ```

### Check SMT Report Status (Ad-hoc / Subscription Reports)
1. After triggering an SMT report (interval/usage fetch), capture the `correlationId`.
2. Call:
   - URL: `POST /api/admin/smt/report-status`
   - Body:
     ```json
     {
       "correlationId": "<corr-id-from-SMT>",
       "serviceType": "ADHOC"
     }
     ```
3. Use returned status fields (status, statusCode, statusReason) to debug stuck or delayed reports.

### Normalize Usage from Usage DB → Master SmtInterval
1. Identify the `houseId` and/or `esiid` whose raw usage has already been ingested into the **usage** DB.
2. Call:
   - URL: `POST /api/admin/usage/normalize`
   - Headers: `x-admin-token: $ADMIN_TOKEN`
   - Body:
     ```json
     {
       "houseId": "<house-id-or-empty>",
       "esiid": "<ESIID-or-empty>",
       "source": "smt",
       "start": "2025-01-01T00:00:00.000Z",
       "end":   "2025-12-31T23:59:59.999Z"
     }
     ```
3. Confirm response summary:
   - `rawCount` > 0
   - `insertedCount` + `updatedCount` matches expectations.
4. Spot-check master DB (`SmtInterval`) for new/updated normalized rows before running any downstream analytics.

Notes:
- All admin endpoints are **non-user-facing** and must only be used by trusted operators.
- Never expose `ADMIN_TOKEN` in logs, UI, or client-side code.

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

## Database / Prisma Operations

- **Canonical: apply master Prisma migrations (dev DB first → then DO `defaultdb`)**
  - **Run these on the droplet in Linux bash** (not Windows PowerShell).
  - **Do not run as `root`** unless you know root has GitHub SSH keys; prefer `deploy`.
  - **Must run from the repo root** (where `package.json` and `prisma/schema.prisma` exist). If you run `npx prisma ...` from `~`, it may prompt to install a random Prisma version and then fail to find `--schema`.

  1. Get into the repo as `deploy` and pull latest `main`:
     - `sudo -iu deploy`
     - `cd /home/deploy/apps/intelliwatt`
     - `git status -sb`
     - `git pull origin main`
     - If you see `Permission denied (publickey)`, you are missing SSH auth for that user. Fix SSH keys (or switch the remote to HTTPS) before continuing.

  2. Install deps (so `npx prisma` uses the pinned repo version):
     - `npm install`

  3. Apply migrations to **dev DB first** (recommended safety check):
     - `export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_dev?sslmode=require"`
     - `npx prisma migrate deploy --schema=prisma/schema.prisma`
     - `npx prisma migrate status --schema=prisma/schema.prisma`

  4. Then apply migrations to **production-ish `defaultdb`**:
     - `export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/defaultdb?sslmode=require"`
     - `npx prisma migrate deploy --schema=prisma/schema.prisma`
     - `npx prisma migrate status --schema=prisma/schema.prisma`

- **Dev DB reset flow (when `migrate deploy` fails with `P3018` / “relation already exists”)**
  - This specifically fixes the case we just hit on `intelliwatt_dev`:
    - `Error: P3018` and Postgres `42P07` like `relation "ErcotEsiidIndex" already exists`
  - Root cause: the dev DB is **not clean** (tables exist but Prisma migration history is not aligned).
  - ✅ **Safe on dev DB**. ❌ **Never run reset on `defaultdb`**.

  Steps (droplet, Linux bash):
  1. Become deploy + go to repo:
     - `sudo -iu deploy`
     - `cd /home/deploy/apps/intelliwatt`
     - `git pull origin main`
     - `npm install`

  2. Point Prisma at dev DB and **reset everything**:
     - `export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_dev?sslmode=require"`
     - `npx prisma migrate reset --force --schema=prisma/schema.prisma`

  3. Re-apply all migrations cleanly:
     - `export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/intelliwatt_dev?sslmode=require"`
     - `npx prisma migrate deploy --schema=prisma/schema.prisma`
     - `npx prisma migrate status --schema=prisma/schema.prisma`

  4. Only after dev DB is clean, move to `defaultdb` with `migrate deploy`.
     - If `defaultdb` fails, do NOT reset; follow the “Recover from failed Prisma migration on DO `defaultdb`” procedure below.

- **Recover from failed Prisma migration on DO `defaultdb`:**
  1. Fix the migration SQL locally to be idempotent (e.g., `CREATE TABLE IF NOT EXISTS`, conditional index rename via DO block), then commit and push.
  2. On the droplet (`deploy@intelliwatt-smt-proxy`):
     - `cd /home/deploy/apps/intelliwatt`
     - `export DATABASE_URL="postgresql://<db_user>:<db_password>@<db_host>:<db_port>/defaultdb?sslmode=require"`
     - If the command errors with “remaining connection slots are reserved for roles with the SUPERUSER attribute”, terminate idle connections in the DO UI first.
     - Mark the migration as rolled back: `npx prisma migrate resolve --rolled-back 20251123035440_puct_rep_dev_setup --schema=prisma/schema.prisma`
     - Re-apply migrations: `npx prisma migrate deploy --schema=prisma/schema.prisma`
  3. Verify no further P3xxx errors and confirm the migration entry exists in `_prisma_migrations`.

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
- **Storage envs:** Ensure Spaces/S3 envs (`S3_*` or `DO_SPACES_*`) are configured when not using Vercel Blob.
- **Webhook auth:** Vercel route `/api/admin/smt/pull` accepts `x-intelliwatt-secret`, `x-smt-secret`, or `x-webhook-secret`; secret value comes from `INTELLIWATT_WEBHOOK_SECRET` (alias `DROPLET_WEBHOOK_SECRET`).
- **Droplet ingest:** Timer `smt-ingest.timer` runs `deploy/smt/fetch_and_post.sh` (uses `/etc/default/intelliwatt-smt` for `ADMIN_TOKEN`, `INTELLIWATT_BASE_URL`, SFTP creds, optional `ESIID_DEFAULT`).
- **Smoke tests:**
  - Bash inline: see `docs/DEPLOY_SMT_INGEST.md` manual post snippet.
  - PowerShell inline: `scripts/admin/smt_inline_post_test.ps1`.
  - Webhook ping: run `scripts/admin/test_webhook.sh` (see repo) to confirm droplet bridge accepts the secret header.

## SMT Support & Escalation Contacts (Reference)

When working incidents or onboarding steps with Smart Meter Texas (SMT), use this contact set:

Primary SMT Support:
- Email: support@smartmetertexas.com
- Phone: 1-844-217-8595

Service Desk Email (in active use for API / CSP tickets):
- Email: rt-smartmeterservicedesk@randstadusa.com

IntelliWatt / Intellipath CSP Identity (for any tickets or enrollment requests):
- Company: Intellipath Solutions LLC / DBA IntelliWatt
- DUNS: 134642921
- PUCT Aggregator Registration Number: 80514
- Business Phone: 817-471-0579
- Contact: Brian Littlefield
- Contact Email: brian.littlefield@intellipath-solutions.com

Note:
- Do NOT use personal phone numbers in SMT or PUCT correspondence.
- Do NOT reference deprecated SMT operational addresses (e.g., smt.operational.support@smartmetertexas.com) in new tickets or docs.
- When opening SMT tickets about CSP New Customer Enrollment, Agreements, or Subscriptions, always include:
  - DUNS, PUCT #, CSP name (Intellipath Solutions LLC / DBA IntelliWatt)
  - Your SMT portal screenshots (e.g., “CSP New Customer Enrollment: OFF”)
  - Your static IP or certificate details if they are requested.

## SMT · SmtBillingRead Table Fix

If Prisma or Prisma Studio reports:

> The table `public.SmtBillingRead` does not exist in the current database.

and `SmtBillingRead` exists in `prisma/schema.prisma` with migration folder `prisma/migrations/20251119070500_add_smt_billing_read`, apply the migration manually:

```bash
# From repo root, with DATABASE_URL set
npm install
npm run db:apply-smt-billing
```