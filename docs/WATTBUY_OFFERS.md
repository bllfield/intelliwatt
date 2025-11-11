# WattBuy Offers Integration (IntelliWatt)

**Goal:** On-demand per-address pull that:

1) Calls `/v3/electricity` to get property context (and `wattkey`),  
2) Triggers SMT ingestion if an ESIID is present,  
3) Calls `/v3/offers` with `all=true` to retrieve the full plan set, plus upgrade/solar offers.

## Endpoints (admin)

- `GET /api/admin/wattbuy/offers?wattkey=...`  

  - OR: `?address=...&city=...&state=tx&zip=...`  

  - Defaults: `language=en`, `is_renter=false`, `all=true`

- `GET /api/admin/wattbuy/offers-by-address?address=...&city=...&state=tx&zip=...`  

  - Convenience alias for address-based requests.

- `GET /api/admin/wattbuy/property-bundle?address=...&city=...&state=tx&zip=...`  

  - Orchestrates: electricity → SMT kick → offers (prefers `wattkey`).

## Notes

- **all=true** returns the large set of plans; omitting it returns their "recommended" subset.

- If electricity response includes an **ESIID**, we POST to your internal SMT route (best-effort).

- Keep your existing Inspector UI to visualize payload shapes and headers; these routes preserve diagnostic headers.

## Example (PowerShell)

```powershell
$BASE = "https://intelliwatt.com"
Invoke-WebRequest "$BASE/api/admin/wattbuy/property-bundle?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116"
```

## TODO (optional)

- Persist plans into `RatePlan` (only when you click "Save" in admin).

- UI: Show utility TDSP & plan grouping (term buckets, green %, superlatives).

- Add category filter pass-through: `category=...` on `/offers` endpoints.

