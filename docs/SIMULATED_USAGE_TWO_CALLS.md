# Simulated usage: two API calls and Past timeout

## Why two calls when you open "Past" on the dashboard?

1. **GET /api/user/usage/simulated** (list)  
   - Called when the simulated usage page loads (or when you switch to the "Simulated" dataset mode).  
   - Returns **one row per house** with **baseline** data only: either actual usage (when the build is SMT_BASELINE and source is SMT/Green Button) or the built curve from the baseline build.  
   - This gives the UI something to show immediately (house list + baseline chart). It does **not** run the Past scenario pipeline.

2. **GET /api/user/usage/simulated/house?houseId=…&scenarioId=…** (house + scenario)  
   - Called when you select **Past** (or Future) for a house.  
   - Returns the **full dataset for that house + scenario** (e.g. Past stitched with travel/vacant gap-fill).  
   - This is the only place that runs the heavy Past pipeline (or serves it from cache).

So: the list intentionally shows **baseline** so the page isn’t empty. The **Past** data comes only from the house endpoint. If that call fails or times out, you keep seeing baseline.

## Why does the Past (house) call return 500 / FUNCTION_INVOCATION_FAILED?

Common causes:

1. **Cache/usage DB unavailable**  
   If the usage DB isn’t configured (`USAGE_DATABASE_URL`) or the `PastSimulatedDatasetCache` table doesn’t exist, the route used to throw when touching the cache. The cache layer is now defensive: cache miss or save failure is non-fatal; the route still builds and returns Past (without caching).

2. **Timeout**  
   The Past pipeline can be slow (full-year intervals, build, encode). The route and `vercel.json` are set for `maxDuration: 300` (5 min). Vercel **Hobby** caps at 10s, so the function can still be killed there. On **Pro**, up to 300s is supported. Ensure the project is Pro if you need long runs.

3. **First request (cold)**  
   The first request for a house+scenario is a cache miss and does a full build; later requests for the same inputs can be served from cache and are much faster.

## Cache save: when does interval data get written to cache?

**Yes.** When the Past dataset is **computed** (cold path), the code **always** saves it to cache:

1. `getSimulatedUsageForHouseScenario` tries cache first (`getCachedPastDataset`).
2. On cache miss it calls `getPastSimulatedDatasetForHouse` to build the dataset.
3. After a successful build it encodes intervals with `encodeIntervalsV1`, then calls `saveCachedPastDataset` with the compressed payload and metadata.

So whenever the house endpoint returns a successful Past response, that response was either served from cache or built and then written to cache. The only case where a successful build is **not** cached is when the usage DB is unavailable (e.g. `USAGE_DATABASE_URL` unset or `PastSimulatedDatasetCache` table missing): then `saveCachedPastDataset` no-ops and the request still succeeds, but the next request will cold-build again.

We do **not** skip cache: we always try cache first and always attempt to save after a successful build.

## Cache freshness: interval data fingerprint

The cache key includes an **interval data fingerprint** so that any change to the underlying actual data invalidates the cache. Format: `count:maxTsEpoch:sumKwhMilli`:

- **count** – number of 15‑minute intervals in the window
- **maxTsEpoch** – latest interval timestamp (epoch ms)
- **sumKwhMilli** – `round(sum(kwh) * 1000)` over the same window (same canonical source as `getActualIntervalsForRange`)

When new intervals are backfilled, or kWh values are corrected for existing timestamps, the fingerprint changes, so the cache key changes:

- **Cache miss** → full Past build runs, then the new result is written to cache.
- Subsequent requests use the new cached dataset.

So cached intervals are never stale: backfills and kWh corrections both cause a rebuild and re-cache. No TTL or manual invalidation is required. The fingerprint is computed by `getIntervalDataFingerprint` in `lib/usage/actualDatasetForHouse.ts` (SMT and Green Button use the same canonical source as production interval reads) and passed into `computePastInputHash` by both the user house route (via `getSimulatedUsageForHouseScenario`) and the Gap-Fill Lab.

### How to verify fingerprint and cache invalidation

1. Run Past once (e.g. Gap-Fill Lab “Run Compare” or dashboard Past view). Note `intervalDataFingerprint` and `inputHash` in the report (Section F) and `cacheHit: false` on first run.
2. Run again with same inputs: `cacheHit: true`, same `inputHash` and `intervalDataFingerprint`.
3. **Backfill:** Add or remove intervals in the window in the DB (SMT or Green Button). Next run: fingerprint changes (count and/or maxTs and/or sumKwhMilli), so `inputHash` changes, `cacheHit: false`, then after rebuild the new result is cached.
4. **kWh correction:** Update one interval’s kWh for an existing timestamp in the window (same count and maxTs). Next run: `sumKwhMilli` changes, so `inputHash` changes, `cacheHit: false`, then rebuild and re-cache.

## Manually priming the cache (admin)

If usage was already pulled but the house never had a successful Past load (e.g. the request timed out before save), the cache was never written. You can prime it without relying on the UI:

**Option A – Admin endpoint (recommended)**  
`POST /api/admin/tools/prime-past-cache` with:

- Headers: `Content-Type: application/json`, `x-admin-token: <ADMIN_TOKEN>`
- Body: `{ "houseId": "<uuid>", "scenarioId": "<past-scenario-uuid>" }`

This runs the same logic as the user house endpoint (build + save to cache). Use the **Past scenario UUID** for that house (e.g. from the simulator builds API or the dashboard). Example:

```bash
curl -X POST "https://intelliwatt.com/api/admin/tools/prime-past-cache" \
  -H "Content-Type: application/json" \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -d '{"houseId":"147bce59-b0f5-48bf-8b3b-4f07ed27ac75","scenarioId":"aad5f05b-e116-43af-8a16-29f25b2ad5f1"}'
```

On success you get `{ "ok": true, "message": "Past dataset built and written to cache. ..." }`. The next user request for that house+scenario will be a cache hit.

**Option B – User house endpoint**  
While logged in as the user (or impersonating), open the Past view and wait for the request to complete, or call:

`GET /api/user/usage/simulated/house?houseId=<id>&scenarioId=<past-uuid>`

with the user’s cookies. If it returns 200, the response was built and saved to cache (assuming the usage DB is configured).

## Making Past reliable and fast

- **Use the usage DB and cache**  
  Configure `USAGE_DATABASE_URL` and run the usage schema migration that creates `PastSimulatedDatasetCache`. Then the first successful Past build is cached; subsequent requests for the same house+scenario+inputs are served from cache and avoid timeouts.

- **Explicit function config**  
  `vercel.json` includes `app/api/user/usage/simulated/house/route.ts` with `maxDuration: 300` and `memory: 1024` so this route gets a long timeout and enough memory on supported plans.

## Could the list return Past so we only have one call?

Not with the current UX: the list is per-house and has no selected scenario. Past is per house **and** scenario (and travel ranges, etc.). So the intended design is:

- **List** = houses + baseline only (light, fast).  
- **House + scenario** = single source of truth for Past (and Future); can be slow on cold, fast on cache hit.

If you changed the client so that in "Past" mode it never showed list data and only showed data from the house endpoint, you could avoid displaying baseline first—but you’d still need the list call for the house list and the house call for the Past dataset. The only way to have “one call” for Past would be to merge list and house+scenario into one endpoint that takes houseId + scenarioId; that would make the list endpoint heavier and slower whenever a scenario is selected.
