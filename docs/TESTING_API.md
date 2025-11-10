# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?

- `.env.local` is loaded by the **server** when you run locally.

- When you call a **deployed** endpoint from your terminal, you're an external client — admin routes still require `x-admin-token`.

- Production env vars live in Vercel → Project → Settings → Environment Variables.

## Deployment URLs

- Production: `https://intelliwatt.com`

- Preview example: `https://<project>-<hash>-vercel.app` (useful to test fresh builds before aliasing)

## Automated Node smoke test (Cursor / CI)

1. `npm i -g vercel` and `vercel login` (select IntelliWatt)

2. Pull prod env vars locally:  

   `vercel env pull .env.vercel --environment=production`

3. Run smoke:  

   `node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com`  

   or: `npm run test:prod -- https://intelliwatt.com`

4. You can also target a preview URL the same way.

The script loads `.env.vercel`, calls public + admin endpoints, and fails fast if secrets are missing.

## Quick sanity endpoints

- Public ping (no token): `GET /api/ping` → `{ ok: true, service: "intelliwatt", ts: "..." }`

- Plain-text ping (no token): `GET /api/ping.txt` → `OK`

- Admin env health: `GET /api/admin/env-health` with `x-admin-token: <ADMIN_TOKEN>`

## WattBuy admin tests (current — no 'offers')

- **Electricity (robust)**  

  `GET /api/admin/wattbuy/electricity-probe?address=...&city=...&state=tx&zip=...`

- **Save electricity snapshot**  

  `GET /api/admin/wattbuy/electricity-save?address=...&city=...&state=tx&zip=...`

- **Retail rates (explicit)**  

  `GET /api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx`

- **Retail rates (by address)**  

  `GET /api/admin/wattbuy/retail-rates-by-address?address=...&city=...&state=tx&zip=...`

- **Retail rates (zip auto-derive)**  

  `GET /api/admin/wattbuy/retail-rates-zip?zip=75201`

All WattBuy admin routes require `x-admin-token: <ADMIN_TOKEN>`.

## ERCOT cron (unchanged)

- Cron echo: `GET /api/admin/ercot/debug/echo-cron` with `x-cron-secret: <CRON_SECRET>`

- Manual run: `GET /api/admin/ercot/cron` with `x-cron-secret: <CRON_SECRET>`

