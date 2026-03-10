# Past Weather Provenance Audit

## 1. Why GapFill Lab validation is still separate

- **Production Past path** (user-facing Past page, cold build, recalc, and Lab “production Past” priming) uses the **shared Past core**: `simulatePastUsageDataset` → `buildPastSimulatedBaselineV1` → `buildCurveFromPatchedIntervals` → `buildSimulatedUsageDatasetFromCurve`. Engine identifier: `shared_past_day_simulator`.
- **GapFill Lab validation** (the scoring run that produces WAPE/MAE etc.) uses a **different engine**: `enginePath: gapfill_test_days_profile`, with `getActualIntervalsForRange(test window only) → simulateIntervalsForTestDaysFromUsageShapeProfile → computeGapFillMetrics`. It does **not** call `simulatePastUsageDataset` or the shared Past day simulator. It scores a small set of test dates using a usage-shape-profile–based simulator, not the full-window Past stitched curve.

So the Past page and GapFill Lab validation are **not** the same engine. The UI previously stated “same engine as GapFill Lab validation,” which was incorrect.

## 2. Why the Past-page claim was misleading

The Past page showed:

- **Simulation core:** shared_past_day_simulator **(same engine as GapFill Lab validation)**

The Lab report for the same house showed:

- **enginePath:** gapfill_test_days_profile  
- **functionsUsed:** getActualIntervalsForRange(test window only) → simulateIntervalsForTestDaysFromUsageShapeProfile → computeGapFillMetrics  

So the **validation** path (test-days profile engine) is not the same as the **production Past** path (shared_past_day_simulator). The phrase “same engine as GapFill Lab validation” was wrong. **Fix applied:** that phrase was removed from the Past page; the line now only shows “Simulation core: shared_past_day_simulator.”

## 3. Whether this house truly has mixed weather in the full Past window

- **Past page** shows “Weather basis: mixed actual + stub weather data” for the **full** Past window (e.g. 366 canonical date keys).
- **GapFill Lab report** shows `weatherRowsBySource: {"OPEN_METEO_CACHE":367}` for the **Lab run’s** weather fetch (test window / scoring context). So for the Lab scoring window, weather is 100% Open-Meteo cached.

Possible explanations for “mixed” on the Past page:

- **(a) Correct:** The **full** Past window (all canonical date keys) has at least one date with a stub row in `HouseDailyWeather` (e.g. backfill failed for some dates, or some dates were filled with stub and never overwritten). A single stub date in 366 makes the summary “mixed_actual_and_stub.”
- **(b) Stale:** Stub rows were written earlier; later, actual weather was backfilled for the date range used by Lab, but not for every date in the full Past window, or the full-window read still sees old stub rows for some keys.
- **(c) Window difference:** Lab’s 367 Open-Meteo rows can be for a slightly different or overlapping set of dates than the full Past canonical window; so full-window provenance can still be mixed even when Lab’s window is all actual.

Without querying `HouseDailyWeather` for this house over the exact canonical date set used by Past, we cannot definitively say “mixed” is wrong. The rule (below) is consistent: **one stub row in the full window** → mixed.

## 4. Exact rule used to derive weatherSourceSummary

**Where:** `modules/simulatedUsage/simulatePastUsageDataset.ts` → `loadWeatherForPastWindow`.

**Steps:**

1. For the **canonical date keys** of the Past window, load weather via `ensureHouseWeatherBackfill` (if lat/lng) or `ensureHouseWeatherStubbed` (if no lat/lng), then `getHouseWeatherDays(..., kind: "ACTUAL_LAST_YEAR")` for those date keys.
2. Build a map `actualWxByDateKey` (dateKey → row). Each row has a `source` field (e.g. `WEATHER_STUB_SOURCE` = `"STUB_V1"` or Open-Meteo source).
3. Count over **all** returned rows:
   - `weatherStubRowCount` = number of rows where `source === WEATHER_STUB_SOURCE`
   - `weatherActualRowCount` = total rows − `weatherStubRowCount`
4. **Rule:**
   - If `weatherRowsCount === 0` → `weatherSourceSummary = "none"`
   - Else if `weatherStubRowCount === weatherRowsCount` → `"stub_only"`
   - Else if `weatherActualRowCount === weatherRowsCount` → `"actual_only"`
   - Else → `"mixed_actual_and_stub"`

So **any** date in the full window with a stub row makes the summary “mixed.” The classification is not “majority” or “all scoring dates”; it is “at least one stub in the full set.”

## 5. Recommended smallest fix if provenance is overly conservative or stale

- **If** we want the UI to say “actual” when **almost all** days are actual (e.g. stub count below a small threshold or only outside the “display window”), we could:
  - Add an optional **strictness** rule, e.g. `weatherSourceSummary = "actual_only"` when `weatherStubRowCount <= 0` or `weatherStubRowCount / weatherRowsCount < 0.01`, and keep “mixed” otherwise.  
  **Risk:** That would be a semantic change and could imply “actual weather” when a few days are still stubbed; current behavior is conservative and truthful (“mixed” if any stub).
- **If** the issue is **stale** stub rows (old stubs never overwritten by backfill):
  - Fix is data/backfill: ensure backfill (or a one-off job) writes actual weather for all canonical dates when the API succeeds, and that we do not leave stub rows for dates we could fill. No change to the provenance **rule** is required; the rule is correct.
- **Current recommendation:** Keep the existing rule. Remove only the misleading “same engine as GapFill Lab validation” label (done). If “mixed” is correct for the full window, the label is truthful. If it is stale, improve backfill/coverage rather than relaxing the summary rule.

## 5a. Stale stub rows (root cause and fix)

**Root cause:** Backfill previously fetched only for date keys that had **no** row (`findMissingHouseWeatherDateKeys`). The repo uses `createMany(..., skipDuplicates: true)`, so it only inserts and never updates. Once a STUB_V1 row existed for a date (e.g. from an earlier partial fetch or first run), later successful API fetches never replaced it.

**Fix:** Backfill now treats “needs actual weather” as: no row **or** row has `source === STUB_V1` (`findDateKeysMissingOrStub`). For dates where the API returns actual data, we delete only STUB_V1 rows for those dates, then insert the actual rows. Real weather rows are never deleted or overwritten with stubs. See `modules/weather/backfill.ts` and `modules/weather/repo.ts` (`deleteHouseWeatherStubRows`, `findDateKeysMissingOrStub`). For repairing existing bad data, see **docs/PAST_WEATHER_STUB_REPAIR.md**.

## 6. Summary

| Item | Status |
|------|--------|
| Past page “same engine as GapFill Lab validation” | **Removed**; label now shows only “Simulation core: shared_past_day_simulator”. |
| GapFill Lab validation engine | Still **separate** (`gapfill_test_days_profile`); not the same as shared Past core. |
| weatherSourceSummary rule | One stub row in the full Past window → “mixed_actual_and_stub”; rule is strict and conservative. |
| Recommended next step | If “mixed” is wrong for a house, verify stub vs actual row counts in `HouseDailyWeather` for the canonical date set; if stub rows are stale, run the repair script (see PAST_WEATHER_STUB_REPAIR.md) or fix backfill/coverage. |
