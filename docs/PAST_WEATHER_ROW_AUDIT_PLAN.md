# Past Weather Row Audit Plan — Boundary Date Check

## Purpose

Diagnosis-only audit to prove whether the Past page’s **“mixed actual + stub”** weather label is caused by **one or more boundary dates** (e.g. 2026-03-09) that:

- Are included in the **Past canonical window** (and thus in the set used to compute `weatherSourceSummary`), but  
- Are **not** included in the **GapFill Lab** weather dump (test + training date set),

so that a single stubbed or missing day at the boundary can make Past “mixed” while Lab’s reported window remains 100% OPEN_METEO_CACHE.

**No code, provenance rules, or UI changes.** This document is for diagnosis and audit scripting only.

---

## 1. Hypothesis (Boundary Date Check)

- **GapFill Lab** weather dump for the house is all OPEN_METEO_CACHE through **2026-03-08**.
- **Past page** still reports **mixed_actual_and_stub** for the full canonical Past window.
- **Past daily table** includes **2026-03-09**.
- **Likely cause:**  
  - Past canonical window includes 2026-03-09 (and possibly other days after Lab’s last test date).  
  - Lab’s weather list is built from **training ∪ test date keys** only (e.g. through 2026-03-08).  
  - So **2026-03-09** (and any other “Past-only” days) may:
    - Be missing from cached Open-Meteo and get stubbed by `loadWeatherForPastWindow`, or  
    - Already be stubbed in `HouseDailyWeather`, or  
    - Never appear in Lab’s weather dump at all.

If that holds, the mixed label is **technically correct** but driven by a very small number of boundary days (possibly one).

---

## 2. What Exact Date Keys Are Used for Past weatherSourceSummary?

**Answer:** The **canonical date keys** for the Past window: every calendar day from `startDate` through `endDate` (inclusive).

**Where it’s defined:**

- **`modules/simulatedUsage/simulatePastUsageDataset.ts`**  
  - `simulatePastUsageDataset` gets `startDate` / `endDate` from `buildInputs` (or from canonical months).  
  - It computes:
    - `canonicalDayStartsMs = enumerateDayStartsMsForWindow(startDate, endDate)`  
    - `canonicalDateKeys = dateKeysFromCanonicalDayStarts(canonicalDayStartsMs)`  
  - Those `canonicalDateKeys` are passed to `loadWeatherForPastWindow({ houseId, startDate, endDate, canonicalDateKeys })`.
- **`modules/usageSimulator/pastStitchedCurve.ts`**  
  - `enumerateDayStartsMsForWindow(startIso, endIso)` returns UTC day-start ms for every day in `[startIso, endIso]` inclusive.  
  - So the set is exactly the calendar days from `startDate` to `endDate` (YYYY-MM-DD).
- **Canonical window range:**  
  - In the main flow, `startDate`/`endDate` come from `canonicalWindowDateRange(canonicalMonths)` in `modules/usageSimulator/service.ts`:  
    - `start = firstMonth + "-01"`  
    - `end = last day of lastMonth` (e.g. for 2026-03 → 2026-03-31).  
  - So for canonical months 2025-03 … 2026-03, the Past provenance set includes **2025-03-01 through 2026-03-31**, hence **2026-03-09 is included**.

**Audit check:** For the house and scenario in question, confirm `buildInputs.canonicalMonths` and the derived `startDate`/`endDate`; then the Past provenance set is exactly `enumerateDayStartsMsForWindow(startDate, endDate)` → `dateKeysFromCanonicalDayStarts(...)`.

---

## 3. Is 2026-03-09 Included in That Set?

**Answer:** **Yes**, whenever the canonical end date is ≥ 2026-03-09 (e.g. when the last canonical month is 2026-03, so end date is 2026-03-31).

**Audit check:** From the same house’s Past build, log or derive `startDate`, `endDate`, and the resulting `canonicalDateKeys` (or at least `canonicalDateKeys.includes("2026-03-09")`).

---

## 4. Does 2026-03-09 Have a Stub Weather Row for This House?

**Answer:** Determine by querying **`HouseDailyWeather`** for this house, `dateKey = '2026-03-09'`, `kind = 'ACTUAL_LAST_YEAR'`, and inspecting `source`.

- If `source = 'STUB_V1'` (or equivalent stub) → that day is stubbed and will contribute to “mixed” when included in Past provenance.  
- If there is no row, then `loadWeatherForPastWindow` will call `ensureHouseWeatherStubbed` for missing keys and then re-read; the row created will be a stub, so again that date would contribute to “mixed.”

**Audit check:** Run the query/script below for the house and the full canonical range; flag rows where `source = 'STUB_V1'`. Pay special attention to **2026-03-09** and any date after Lab’s last reported weather date (e.g. 2026-03-08).

---

## 5. Any Other Date in the Past Canonical Window Stubbed While Lab’s Window Is All OPEN_METEO?

**Answer:** Compare two sets:

- **Set A — Past provenance:** All `canonicalDateKeys` (startDate … endDate).  
- **Set B — Lab weather dump:** The date keys that appear in the Lab run’s weather payload (training ∪ test date keys; for the reported run this often ends at 2026-03-08).

Then, for this house, list **HouseDailyWeather** rows for Set A with `kind = 'ACTUAL_LAST_YEAR'` and `source = 'STUB_V1'`.  

- Any stubbed date in **A \ B** (in Past but not in Lab’s dump) can cause Past to show “mixed” while Lab shows 100% OPEN_METEO for its own set.  
- **2026-03-09** is the first date to inspect as the canonical “one day after Lab’s end.”

**Audit check:** Use the script below to list `dateKey`, `source`, `kind` for the full canonical range; then intersect with “dates in Past but not in Lab dump” and highlight which of those are stubbed.

---

## 6. Is Provenance Computed from ACTUAL_LAST_YEAR Only or a Merged Set?

**Answer:** **ACTUAL_LAST_YEAR only.** The summary is not merged with NORMAL_AVG for the label.

**Where:**  
`loadWeatherForPastWindow` in `modules/simulatedUsage/simulatePastUsageDataset.ts`:

- Calls `getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" })` (and separately NORMAL_AVG for simulation).
- Builds provenance from the **ACTUAL_LAST_YEAR** map only: iterates `actualWxByDateKey` entries, counts rows where `source === WEATHER_STUB_SOURCE` vs non-stub, and sets `weatherSourceSummary` (e.g. one stub → `"mixed_actual_and_stub"`).

So the Past weather label is driven solely by ACTUAL_LAST_YEAR rows for the canonical date keys.

---

## 7. Smallest Safe Script / Query Plan

Use this to print, for **one house** and the **exact Past canonical window**, every ACTUAL_LAST_YEAR weather row with `dateKey`, `source`, `kind`, and to highlight dates that are in the Past set but typically absent from Lab’s weather dump (e.g. 2026-03-09).

### 7.1 Parameters (example — replace with real values)

- **houseId:** e.g. `8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8`  
- **Canonical window:** e.g. `startDate = '2025-03-01'`, `endDate = '2026-03-31'`  
- **Lab weather dump end (for comparison):** e.g. `2026-03-08`

### 7.2 SQL (read-only)

Target table: **`HouseDailyWeather`** (Prisma model `HouseDailyWeather`; table name may be `"HouseDailyWeather"` depending on DB).

```sql
-- Replace :houseId, :startDate, :endDate with the canonical window for this house.
SELECT "dateKey", "source", "kind"
FROM "HouseDailyWeather"
WHERE "houseId" = :houseId
  AND "kind" = 'ACTUAL_LAST_YEAR'
  AND "dateKey" >= :startDate
  AND "dateKey" <= :endDate
ORDER BY "dateKey";
```

Interpretation:

- **source = 'STUB_V1'** → stub row; contributes to “mixed” if this date is in Past provenance.  
- **source = 'OPEN_METEO_CACHE'** (or similar) → actual row.  
- Missing `dateKey` in range → that day would be stubbed on next Past load and then contribute to “mixed.”

### 7.3 Optional: Node/TypeScript one-off (read-only)

- Resolve **canonical date keys** the same way as Past:  
  `enumerateDayStartsMsForWindow(startDate, endDate)` → `dateKeysFromCanonicalDayStarts(...)` from `modules/usageSimulator/pastStitchedCurve` and `simulatePastUsageDataset`.  
- Call **`getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" })`** (`modules/weather/repo.ts`).  
- Print for each dateKey in canonicalDateKeys:
  - `dateKey`, `source`, `kind` (from the returned map, or “MISSING” if not in map).  
- **Highlight** dates that:
  - Are in canonicalDateKeys but **after** the Lab weather dump end (e.g. `dateKey > '2026-03-08'`), or  
  - Are in a pre-agreed “Past-only” list (e.g. `['2026-03-09']`).  
- For those, note whether the row is **stub** (`source === 'STUB_V1'`) or missing (would become stub on next load).

### 7.4 What to Report

- Full list: `dateKey`, `source`, `kind` for the house and canonical window.  
- **Dates in Past provenance but not in Lab weather dump:** e.g. 2026-03-09 and any later dates; call out explicitly.  
- For those boundary dates: **stub, actual, or missing.**  
- If any boundary date is stubbed (or missing), that is sufficient to explain “mixed” on the Past page while Lab shows OPEN_METEO_CACHE only for its window.

---

## 8. Summary Table

| Question | Answer |
|----------|--------|
| 1. Exact date keys for Past weatherSourceSummary | Canonical day set: `dateKeysFromCanonicalDayStarts(enumerateDayStartsMsForWindow(startDate, endDate))` for the build’s start/end. |
| 2. Is 2026-03-09 in that set? | Yes, when endDate ≥ 2026-03-09 (e.g. last canonical month 2026-03 → end 2026-03-31). |
| 3. Is 2026-03-09 stubbed for this house? | Check HouseDailyWeather: houseId, dateKey = 2026-03-09, kind = ACTUAL_LAST_YEAR → source STUB_V1 or missing. |
| 4. Other Past-only dates stubbed? | List ACTUAL_LAST_YEAR rows with source = STUB_V1 in canonical range; intersect with (Past date set \ Lab weather date set). |
| 5. Provenance from ACTUAL_LAST_YEAR only or merged? | ACTUAL_LAST_YEAR only; NORMAL_AVG is not used for the summary. |

---

## 9. References

- **Past provenance rule:** `docs/PAST_WEATHER_PROVENANCE_AUDIT.md`  
- **Past weather loading:** `modules/simulatedUsage/simulatePastUsageDataset.ts` → `loadWeatherForPastWindow`  
- **Canonical window:** `modules/usageSimulator/service.ts` → `canonicalWindowDateRange`; `modules/usageSimulator/pastStitchedCurve.ts` → `enumerateDayStartsMsForWindow`  
- **Weather DB:** `modules/weather/repo.ts` → `getHouseWeatherDays`; table `HouseDailyWeather`  
- **Lab weather set:** `app/api/admin/tools/gapfill-lab/route.ts` — weather from `dateKeysForWeather = trainingDateKeysSet ∪ testDateKeysSorted` (often ends at last test date, e.g. 2026-03-08).

---

## 10. Resolved path (stale stubs)

The boundary-date audit confirmed that stub rows (e.g. 2026-03-06–08 and early-window dates) were present while adjacent days had OPEN_METEO_CACHE. Root cause: backfill only filled **missing** dates and the repo never overwrote existing rows. The loader was updated to replace STUB_V1 rows when actual data is available, and a repair script was added. See **docs/PAST_WEATHER_STUB_REPAIR.md** and **docs/PAST_WEATHER_PROVENANCE_AUDIT.md** (§5a).
