# Past Simulator: Timeout and 0 kWh Investigation

## Summary

- **Recent GapFill Lab changes** (testMode, timezone for weather, UI) do **not** touch the Past simulator path. No code in `getPastSimulatedDatasetForHouse`, `buildPastSimulatedBaselineV1`, or the user house route was modified by those commits.
- **0 kWh months** were addressed by making monthly display timezone-aware (see fix below).
- **Timeout** is most likely due to **cache misses** on every request, forcing a full cold build each time.

---

## 1. Timeout (won’t process without timing out)

**Likely cause: cache miss on every request.**

The Past response is cached in the usage DB by `(houseId, scenarioId, inputHash)`. When the cache key changes, the handler runs a full cold build (`getPastSimulatedDatasetForHouse`), which can take several minutes and hit the 300s route limit.

**What changes the cache key (inputHash):**

- `intervalDataFingerprint` – from `getIntervalDataFingerprint(houseId, esiid, startDate, endDate)`. It depends on **COUNT** and **MAX(ts)** of actual intervals in the window. Any backfill, new data, or change in that range will change the fingerprint and invalidate the cache.
- `buildInputsHash` – hash of `buildInputs`. Any change to build inputs (e.g. travel ranges, scenario, timezone, canonical months) will change the hash.

**What to check:**

1. **Response meta**  
   In the JSON response, check:
   - `meta.pastBuildIntervalsFetchCount`: **0** = cache hit, **1** = cold build.
   - `meta.cacheKeyDiag.inputHash` and `meta.cacheKeyDiag.intervalDataFingerprint`.

2. **Recent data or config changes**  
   - New SMT/Green Button backfill or any change in the interval window will change `intervalDataFingerprint` and cause repeated cache misses.
   - If the build was recalculated with different travel ranges, timezone, or window, `buildInputsHash` will change.

3. **Mitigations**  
   - **Prime the cache** once from Admin (e.g. prime-past-cache or GapFill Lab flow) so the next user open gets a cache hit.
   - Ensure **Vercel Pro** (or equivalent) so the route can use `maxDuration: 300` (5 min). Hobby has a 10s cap.
   - If the cold build is still too slow, consider optimizing the builder or adding a background job to prime the cache after build/recalc.

---

## 2. 0 kWh for some months (fix applied)

**Cause:** Monthly totals were computed by grouping interval timestamps in **America/Chicago** only (`chicagoParts(ts)` in `buildDisplayMonthlyFromIntervals`). The Past curve is built with UTC day boundaries; grouping in Chicago can put intervals in the wrong calendar month for other timezones and produce empty months (0 kWh).

**Fix:** Monthly display is now timezone-aware.

- **`modules/usageSimulator/dataset.ts`**
  - Added `datePartsInTimezone(ts, tz)` and use it when a timezone is provided.
  - `buildDisplayMonthlyFromIntervals(..., { timezone?: string })` now groups by the house/build timezone when given; otherwise it still defaults to `America/Chicago`.
- **`buildSimulatedUsageDatasetFromCurve(..., options?: { timezone?: string })`**  
  Passes `timezone` through to `buildDisplayMonthlyFromIntervals`.
- **`modules/usageSimulator/service.ts`**
  - In `getPastSimulatedDatasetForHouse`, the call to `buildSimulatedUsageDatasetFromCurve` now passes `timezone` from the build (e.g. `buildInputs.timezone` or the Past args).
  - In the recalc path that builds from `pastPatchedCurve`, the same `buildInputs.timezone` is passed.

So when the build has a timezone (e.g. house timezone), Past monthly totals are grouped by that timezone and should no longer show incorrect 0 kWh months for non-Chicago users.

---

## 3. Files changed in this fix

- `modules/usageSimulator/dataset.ts` – timezone-aware monthly grouping.
- `modules/usageSimulator/service.ts` – pass `timezone` into `buildSimulatedUsageDatasetFromCurve` for Past and recalc paths.

No changes were made to the simulator engine, weather, or cache key logic; only how monthly display is derived from the existing curve.

---

## User Past weather provenance validation

The user-facing **Past** simulated usage flow now exposes the same truthfulness and validation rules as GapFill Lab for weather provenance. Past dataset meta must never imply "real weather" when the dataset is backed by stub or default weather.

- **`sourceOfDaySimulationCore`** — Exposed in the user-facing Past payload so clients can confirm the shared past-day simulator core (e.g. `shared_past_day_simulator`).

- **`weatherSourceSummary`** — One of: `actual_only`, `stub_only`, `mixed_actual_and_stub`, `none`. Only when `actual_only` may the UI use wording like "actual cached weather data." For `stub_only`, never present as real weather. For `mixed_actual_and_stub`, use "mixed actual + stub weather data." For `none`, do not show a weather-basis line.

- **STUB_V1 is not real weather** — Rows with `source === "STUB_V1"` are test/default data and must not be labeled as "actual" or "real."

- **Same provenance logic as GapFill Lab** — Both flows should be validated using the same provenance logic: `weatherSourceSummary`, `weatherKindUsed`, and the weather row counts/coverage fields in meta.

---

## Why "mixed" weather and the backfill fix

Previously, the Past build path called **ensureHouseWeatherStubbed** before fetching from the weather API. That filled every missing day with stub data first, so there were no "missing" days left to fetch — the UI showed "mixed" (or all stub) even when the house had lat/lng and the API could return real data.

**Fix:** Both the inline Past path (buildInputs) and **getPastSimulatedDatasetForHouse** now call **ensureHouseWeatherBackfill** when the house has lat/lng. Backfill: find missing dates → fetch from weather API → persist → then stub only any still-missing dates. So real weather is fetched and stored before stubs are used. After a cold build (or cache invalidation), the UI should show "actual cached weather data" when the API returns data for the full window. If the API has limits (e.g. historical range) or fails for part of the range, you will still see "mixed"; ensure the house has valid lat/lng and that the weather service covers the requested date range.
