# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?

- `.env.local` is loaded by the **server** when you run locally.

- From your terminal against a deployed URL, you're an external client — admin routes still require `x-admin-token`.

- Prod env vars live in Vercel → Project → Settings → Environment Variables.

## Deployment URLs

- Production: `https://intelliwatt.com`

- Preview example: `https://<project>-<hash>-vercel.app`

## Automated Node smoke test (Cursor / CI)

1. `npm i -g vercel` and `vercel login`

2. Pull prod envs: `vercel env pull .env.vercel --environment=production`

3. Run: `node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com`

   - or: `npm run test:prod -- https://intelliwatt.com`

## Quick sanity endpoints

- Public ping: `GET /api/ping` → `{ ok: true, ... }`

- Text ping: `GET /api/ping.txt` → `OK`

- Env health: `GET /api/admin/env-health` with `x-admin-token: <ADMIN_TOKEN>`

## ERCOT cron

- Echo (optional): `GET /api/admin/ercot/cron?token=<CRON_SECRET>`

- Vercel Managed Cron calls `/api/admin/ercot/cron` (no headers). We allow either:

  - Header: `x-cron-secret: <CRON_SECRET>` **or**

  - Query: `?token=<CRON_SECRET>`

## WattBuy (current — unchanged)

- Electricity (robust): `GET /api/admin/wattbuy/electricity-probe?address=...&city=...&state=tx&zip=...`

- Save electricity snapshot: `GET /api/admin/wattbuy/electricity-save?address=...&city=...&state=tx&zip=...`

- Retail rates (explicit): `GET /api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx`

- Retail rates (by address): `GET /api/admin/wattbuy/retail-rates-by-address?address=...&city=...&state=tx&zip=...`

- Retail rates (zip): `GET /api/admin/wattbuy/retail-rates-zip?zip=75201`
