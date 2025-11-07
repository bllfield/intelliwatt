# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?
- `.env.local` is loaded by the Next.js **server** when you run locally.
- When you call a deployed endpoint from your shell, you are an **external client**—the server still expects `x-admin-token` (or other headers) to prove admin access.
- Production env vars live in Vercel → Project → Settings → Environment Variables. Your local file does **not** apply to Vercel automatically.

## Deployment URLs
- Production domain: `https://intelliwatt.com`
- Production deployment URL example: `https://<project>-<hash>-vercel.app`
  - Useful for verifying a fresh build before the alias moves.

## Automated Node smoke test (Cursor / CI)
1. Ensure you have the Vercel CLI set up:
   - `npm i -g vercel`
   - `vercel login` (select the IntelliWatt project/team)
2. Pull Production env vars locally (creates `.env.vercel`):
   - `vercel env pull .env.vercel --environment=production`
3. Run the smoke:
   - `node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com`
   - or `npm run test:prod -- https://intelliwatt.com`
4. Testing a fresh Production deployment before the alias moves:
   - `npm run test:prod -- https://<your-prod-deployment>.vercel.app`

The script automatically loads `.env.vercel`, calls public + admin endpoints, and fails fast if required secrets are missing.

## Quick sanity endpoints
- Public ping (no token): `GET /api/ping` → `{ ok: true, service: "intelliwatt", ts: "..." }`
- Admin env health (token required): `GET /api/admin/env-health` with header `x-admin-token: <ADMIN_TOKEN>`

## Turnkey scripts (manual shells)
- Windows PowerShell: `scripts/admin/api_test.ps1`
- macOS/Linux (bash): `scripts/admin/api_test.sh`

Provide:
- `BASE_URL` (e.g., `https://intelliwatt.com` or a preview URL)
- `ADMIN_TOKEN` (for admin routes)
- `CRON_SECRET` (for cron/echo endpoints)

They exit early with helpful errors if any variable is missing.
