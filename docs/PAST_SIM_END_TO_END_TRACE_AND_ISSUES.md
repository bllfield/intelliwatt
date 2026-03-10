# Past Simulated Usage: End-to-End Trace and Issues

This document traces how Past simulated usage is built, cached, and displayed, and lists issues that can cause wrong or flat daily curves.

---

## 1. Entry points and data flow

### 1.1 List (simulator page load)

| Step | Location | What happens |
|------|----------|----------------|
| 1 | Client | `GET /api/user/usage/simulated` (no houseId/scenarioId) |
| 2 | `app/api/user/usage/simulated/route.ts` | `getSimulatedUsageForUser({ userId })` |
| 3 | `modules/usageSimulator/service.ts` → `getSimulatedUsageForUser` | For each house: load **BASELINE** build from `UsageSimulatorBuild`, then either `getActualUsageDatasetForHouse` (SMT_BASELINE) or `buildSimulatedUsageDatasetFromBuildInputs(buildInputs)`. **Past is not built here**; list returns baseline only. |

**Result:** List shows one row per house with **baseline** dataset only. No Past pipeline runs.

---

### 1.2 Selecting Past (dashboard curve view)

| Step | Location | What happens |
|------|----------|----------------|
| 1 | Client | User selects "Past" → `viewScenarioId` = Past scenario id. `useEffect` in `UsageSimulatorClient` depends on `[houseId, viewScenarioId, refreshToken]`. |
| 2 | Client | `GET /api/user/usage/simulated/house?houseId=<id>&scenarioId=<pastScenarioId>` |
| 3 | `app/api/user/usage/simulated/house/route.ts` | With `scenarioId` set: `getSimulatedUsageForHouseScenario({ userId, houseId, scenarioId })`. |
| 4 | `modules/usageSimulator/service.ts` → `getSimulatedUsageForHouseScenario` | Loads Past build from `UsageSimulatorBuild` (same scenarioKey = Past scenario id). If **Past + SMT_BASELINE**: computes cache key then either **cache hit** or **cold build**. |

**Result:** Response is the **house** endpoint result: either decoded cache or full build from `getPastSimulatedDatasetForHouse`. Client sets `scenarioSimHouseOverride = [{ houseId, dataset: j.dataset }]` and passes it to `UsageDashboard` as `simulatedHousesOverride`. Dashboard uses `dataset.daily`, `dataset.monthly`, `dataset.series.intervals15` from that.

---

### 1.3 Recalc (e.g. “Save” or “Recalculate”)

| Step | Location | What happens |
|------|----------|----------------|
| 1 | Client | `POST /api/user/simulator/recalc` with `{ houseId, mode, scenarioId: pastScenario.id, weatherPreference }`. |
| 2 | `app/api/user/simulator/recalc/route.ts` | `recalcSimulatorBuild({ userId, houseId, esiid, mode, scenarioId, weatherPreference })`. |
| 3 | `modules/usageSimulator/service.ts` → `recalcSimulatorBuild` | Builds baseline inputs; if **Past** scenario: in a try block: `getActualIntervalsForRange(houseId, esiid, startDate, endDate)` → `buildPastSimulatedBaselineV1(...)` → `buildCurveFromPatchedIntervals(...)` → `buildSimulatedUsageDatasetFromCurve(pastPatchedCurve, ..., { timezone })`. **Does not pass `useUtcMonth: true`.** Saves build to DB; returns `{ ok: true, dataset }` (the built dataset). |
| 4 | Client | On success: `setRefreshToken((x) => x + 1)`. That retriggers the house fetch (step 1.2), so the UI refetches `GET house?scenarioId=Past` and shows **that** response, not the recalc response body. |

**Result:** Recalc builds Past in memory and persists buildInputs; the dashboard then shows whatever the **house** endpoint returns after refetch (cache or cold build).

---

## 2. Cold build: getPastSimulatedDatasetForHouse

Single canonical path for “full” Past stitched dataset (used by both dashboard and GapFill Lab).

| Step | Location | What happens |
|------|----------|----------------|
| 1 | `getPastSimulatedDatasetForHouse` (service.ts) | `getActualIntervalsForRange(houseId, esiid, startDate, endDate)` → reads **SMT** (`SmtInterval` by esiid) or **Green Button** (`GreenButtonInterval` by houseId). If no source or empty → returns `[]`. |
| 2 | Same | Weather: `ensureHouseWeatherBackfill` then `getHouseWeatherDays` (ACTUAL_LAST_YEAR, NORMAL_AVG) for all canonical date keys. |
| 3 | Same | Profiles: `getHomeProfileSimulatedByUserHouse`, `getApplianceProfileSimulatedByUserHouse`, `getLatestUsageShapeProfile(houseId)`. Optional: `usageShapeProfileSnap` (weekday/weekend avg by month) for day totals when no weather. |
| 4 | Same | `buildPastSimulatedBaselineV1({ actualIntervals, canonicalDayStartsMs, excludedDateKeys, dateKeyFromTimestamp, getDayGridTimestamps, homeProfile, applianceProfile, usageShapeProfile, timezoneForProfile, actualWxByDateKey, _normalWxByDateKey })` → **engine.ts**. |
| 5 | `modules/simulatedUsage/engine.ts` → `buildPastSimulatedBaselineV1` | Builds **reference days**: only days that are **not** excluded and **not** “leading missing” (before first actual interval). For each reference day: slotKwh from actuals, hourly weights, quarterShapeByHour, weather, hvacRef. If **no reference days** (e.g. `actualIntervals` empty): `shapeByMonth96Ref` = `{}`, `pastContext.profile` still has month keys but from empty refs. |
| 6 | Same | For each canonical day: if **shouldSimulateDay** (excluded or leading missing): `simulatePastDay(..., pastContext, homeProfile, applianceProfile, shapeByMonth96Ref)`. Else: use actual slot kWh. |
| 7 | `modules/simulatedUsage/pastDaySimulator.ts` → `simulatePastDay` | Day total from profile + weather adjustment. **Shape:** `shape96 = shapeByMonth96?.[monthKey]` if present and length 96, else **`Array(96).fill(1/96)`** (flat). Intervals = `targetKwh * normShape[i]`. So if `shapeByMonth96Ref` is empty or missing that month → **flat 15‑min distribution** for that day. |
| 8 | service.ts | `buildCurveFromPatchedIntervals({ startDate, endDate, intervals })` → `SimulatedCurve` (intervals + monthlyTotals + annualTotalKwh). |
| 9 | service.ts | `buildSimulatedUsageDatasetFromCurve(stitchedCurve, meta, { timezone, useUtcMonth: true })` → **dataset.ts**. |
| 10 | `modules/usageSimulator/dataset.ts` → `buildSimulatedUsageDatasetFromCurve` | Daily from curve.intervals (sum by date). Monthly from `buildDisplayMonthlyFromIntervals(..., useUtcMonth)`. Series: intervals15, daily, monthly. Insights: baseload, weekday/weekend, etc. |
| 11 | service.ts | Optional overlay: `getActualUsageDatasetForHouse(..., { skipFullYearIntervalFetch: true })` and replace non–travel-month monthly with actual monthly. Attach `dailyWeather`, meta (e.g. `usageShapeProfileDiag`, `dayTotalSource`). |

**Critical dependency:** Variable daily curve requires **non-empty actualIntervals** so that reference days exist → `shapeByMonth96Ref` is populated per month → `simulatePastDay` uses real intraday shape instead of flat 1/96.

---

## 3. Cache (Past)

| Component | Location | Behavior |
|-----------|----------|----------|
| Key | `modules/usageSimulator/pastCache.ts` → `computePastInputHash` | Hash of: `engineVersion`, `windowStartUtc`, `windowEndUtc`, `timezone`, sorted `travelRanges`, `stableHashObject(buildInputs)`, **`intervalDataFingerprint`**. |
| Fingerprint | `lib/usage/actualDatasetForHouse.ts` → `getIntervalDataFingerprint` | For SMT: `COUNT(*), MAX(ts)` in window → `"count:maxTsEpoch"`. For Green Button: same from `GreenButtonInterval`. When intervals backfill or change, fingerprint changes → cache miss. |
| Lookup | service.ts → `getSimulatedUsageForHouseScenario` (Past + SMT path) | Before cold build: `getIntervalDataFingerprint` then `computePastInputHash` then `getCachedPastDataset(houseId, scenarioId, inputHash)`. If hit: decode intervals from stored bytes, restore `dataset.series.intervals15`, **recompute** `monthly`/`usageBucketsByMonth`/`daily` from decoded intervals via `buildDisplayMonthlyFromIntervalsUtc` and `buildDailyFromIntervals`. |
| Save | Same (after cold build) | `encodeIntervalsV1(intervals15)` → store `datasetJson` (with `intervals15` stripped), compressed bytes in `PastSimulatedDatasetCache`. |

So: cache hit uses **decoded** intervals to recompute daily/monthly; the curve shape (flat vs variable) is whatever was stored in those intervals.

---

## 4. Recalc vs house endpoint (why “Recal” can look different)

- **Recalc** builds Past in process: `getActualIntervalsForRange` → `buildPastSimulatedBaselineV1` → `buildSimulatedUsageDatasetFromCurve` and returns that dataset. It does **not** read or write the Past cache. After success, client bumps `refreshToken` and refetches **house**.
- **House** endpoint: if cache hit, returns decoded cache (possibly built earlier when actuals were empty). If cache miss, runs same cold build as above.

So the dashboard always shows the **house** response. If that response was from an old cache entry (e.g. from when SMT had no data), daily curve will be flat. Recalc does not invalidate cache by key directly; cache key includes `intervalDataFingerprint`, so once SMT has data, next house request should miss cache and cold build. If cold build still sees empty `getActualIntervalsForRange` (e.g. wrong window, esiid, or DB), reference days stay empty → flat curve.

---

## 5. UI consumption

| Source | Location | Uses |
|--------|----------|------|
| `UsageDashboard` | `components/usage/UsageDashboard.tsx` | When `simulatedHousesOverride` is set (Past/Future selected): `activeHouse.dataset` from override. `derived` useMemo: `monthly` = `dataset?.monthly ?? dataset?.insights?.monthlyTotals`, `daily` = `dataset?.daily` or fallback from `dataset?.series?.daily`; filters by `coverageStart`/`coverageEnd`, dedupes by date. Totals from `dataset.totals` or derived from monthly/daily. |
| Charts/tables | Same | Use `derived.monthlySorted`, `derived.fallbackDaily`, `derived.totals`, etc. So any wrong or flat data in `dataset.daily` / `dataset.monthly` shows as-is. |

---

## 6. Identified issues

### 6.1 Flat daily curve when actual intervals are missing or unused

- **Cause:** `buildPastSimulatedBaselineV1` only has “reference days” when there are actual intervals for non-excluded, non–leading-missing days. If `getActualIntervalsForRange` returns empty (no SMT/Green Button, wrong esiid/houseId, or wrong start/end), then `referenceDays.length === 0` → `shapeByMonth96Ref` is empty → for every simulated day `simulatePastDay` uses `shape96 = Array(96).fill(1/96)` → flat curve.
- **Where to check:** Ensure for the house/window: (1) `getActualIntervalsForRange` is called with correct `houseId`, `esiid`, `startDate`, `endDate`; (2) SMT or Green Button actually has intervals in that range; (3) no bug in date key or timezone so that “reference” days are not all classified as excluded or leading missing.

### 6.2 Recalc path does not pass `useUtcMonth: true`

- **Location:** `modules/usageSimulator/service.ts` ~758–764.
- **Code:** `buildSimulatedUsageDatasetFromCurve(pastPatchedCurve, { ... }, { timezone: (buildInputs as any).timezone ?? undefined })` — no `useUtcMonth: true`.
- **Effect:** Monthly aggregation in the recalc-built dataset uses local timezone; cold build in `getPastSimulatedDatasetForHouse` uses `useUtcMonth: true`. So monthly totals (and any downstream that use monthly) can differ between “built on recalc” and “built on house fetch” for the same inputs. Daily from curve is the same; only monthly grouping differs.

**Recommendation:** Pass `useUtcMonth: true` in the recalc path when building from `pastPatchedCurve`, to match cold build and fix monthly alignment with daily.

### 6.3 Stale cache with flat curve

- **Scenario:** Cache was filled when actuals were empty (e.g. before SMT backfill). Fingerprint was e.g. `"0:"`. Later, data is backfilled; fingerprint becomes e.g. `"35040:..."` → different key → cache miss and cold build. So in theory stale flat cache should be invalidated.
- **If flat persists:** Either (1) fingerprint is not updated (e.g. wrong range or source), (2) cold build still gets no/insufficient intervals, or (3) another code path serves a fallback dataset built without actuals (e.g. `buildSimulatedUsageDatasetFromBuildInputs`). For Past + SMT we always use cache or `getPastSimulatedDatasetForHouse`; fallback to `buildSimulatedUsageDatasetFromBuildInputs` is only when we never entered the Past-stitched path.

### 6.4 UsageShapeProfile only affects day total, not shape

- **In getPastSimulatedDatasetForHouse:** `usageShapeProfileSnap` (weekday/weekend avg by month) is passed to `buildPastSimulatedBaselineV1` as `usageShapeProfile` and used for **day total** when no weather; it does **not** supply 96-slot shape. The 96-slot shape comes only from **reference days** in the engine (`shapeByMonth96Ref`). So if there are no reference days, profile does not fix flat curve.

### 6.5 Possible timezone/date alignment

- **Engine** uses `dateKeyFromTimestamp` and `getDayGridTimestamps` from the service (UTC day grid). Reference days are built from actual intervals and canonical day starts. If the window or day boundaries are misaligned with where actuals live (e.g. timezone vs UTC), more days might be classified as “leading missing” or excluded, reducing reference days and pushing toward flat shape. Worth verifying that `startDate`/`endDate` and `canonicalDayStartsMs` match the actual data window.

---

## 7. Summary

- **End-to-end:** List = baseline only. Past = house endpoint = cache (decoded + recomputed daily/monthly) or cold build = `getPastSimulatedDatasetForHouse` = actual intervals → `buildPastSimulatedBaselineV1` → reference days → `shapeByMonth96Ref` → `simulatePastDay` (or actuals) → curve → `buildSimulatedUsageDatasetFromCurve`. Recalc builds the same curve in process but does not serve it to the dashboard; the dashboard refetches house and shows that response.
- **Most likely cause of flat curve:** Empty or insufficient **actual intervals** for the house/window, so no reference days → empty `shapeByMonth96Ref` → flat 1/96 in `simulatePastDay`. Fix by ensuring `getActualIntervalsForRange` returns the expected data and that the Past window aligns with that data.
- **Definite bug:** Recalc path should pass `useUtcMonth: true` into `buildSimulatedUsageDatasetFromCurve` so monthly matches cold build and daily.
