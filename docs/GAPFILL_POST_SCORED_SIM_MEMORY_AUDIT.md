# Gap-Fill compare_core: post–`scored_sim_rows` memory audit (report-only)

**Scope:** Verification of the compact compare path, phase ordering, and post–`build_shared_compare_scored_sim_rows_ready` allocations. **No runtime or doc changes** except this file.

**Audit date:** Based on repository state at time of audit (`modules/usageSimulator/service.ts`, `app/api/admin/tools/gapfill-lab/route.ts`, tests).

---

## 1) Executive Summary

**Confirmed truths (in code)**

- **`compareCoreMemoryReducedPath`** is gated by the **caller argument** `selectedDaysLightweightArtifactRead === true` (not the internal `useSelectedDaysLightweightArtifactRead` that exact travel parity can clear). It also requires `effectiveCompareFreshMode === "selected_days"`, `!rebuildArtifact`, `!autoEnsureArtifact`, `includeDiagnostics !== true`, `includeFullReportText !== true`. See `modules/usageSimulator/service.ts` (~1206–1212).
- **`compactPathEligible`** in `build_shared_compare_inputs_ready` is set to **`compareCoreMemoryReducedPath`** (~1895–1896): same boolean.
- **Gap-Fill route** sets `selectedDaysCoreLightweight = compareFreshMode === "selected_days" && !includeDiagnostics && !includeFullReportText`, passes **`selectedDaysLightweightArtifactRead: selectedDaysCoreLightweight`** and explicit **`includeDiagnostics` / `includeFullReportText`** from the request body into `buildGapfillCompareSimShared` (~2131–2134, ~2306–2318). So lightweight selected-days requests align with service defaults only when the route passes `false` for diagnostics/full report (defaults inside the service are `true` if omitted—route passes explicitly).
- **`build_shared_compare_compact_post_scored_sim_ready`** is emitted only inside **`if (compareCoreMemoryReducedPath)`** and only **after** travel/vacant parity rows + `travelVacantParityTruth` are computed (~2672–2682). It is **not** emitted immediately after `build_shared_compare_scored_sim_rows_ready`.
- **Latest reductions** (slim `canonicalArtifactSimulatedDayTotalsByDate`, overwrite dataset meta with slim map, `exactParityArtifactIntervals.length = 0` for **owned decode buffer**) run in the block **after** full canonical merge/backfill (~2354–2374) and decode-buffer truncate **after** travel parity (~2672–2675). **`accuracyTuningBreakdowns` / `missAttributionSummary` / `snapshotJson`** are **not** built inside `buildGapfillCompareSimShared` (no matches in `service.ts`); they are route concerns around snapshot/response assembly.

**Likely remaining memory hotspot**

- **Immediately after `await reportPhase("build_shared_compare_scored_sim_rows_ready", …)`** (~2265–2272), the hot path allocates **`exactParityArtifactIntervals`** (possibly **`decodeIntervalsV1(cached.intervalsCompressed)`** when `dataset.series.intervals15` is empty but exact travel parity requires interval-backed truth), builds **`artifactDatasetForExactParity`** (~2306–2317), runs **`buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset`** (~2318–2322), then **merges** into a spread copy of the full canonical map (~2326–2347). **Slimming** (~2358–2374) runs **after** that peak. If the process OOMs between ~2265 and ~2407, logs would show **`build_shared_compare_scored_sim_rows_ready`** but **not** `build_shared_compare_scored_row_keys_ready` or later phases—consistent with “stops after scored_sim_rows” without proving undeployed code.

**Are the latest compact reductions early enough?**

- **Partially.** Slimming and meta overwrite **do** shrink the canonical map **before** `artifactSimulatedDayReferenceRows`, `canonicalArtifactDailyByDate`, parity maps, and merge phases—but **only after** the largest allocations from **decode + full canonical build + full `merged` spread**. **Decode-buffer truncate** runs **late** (after travel parity), so it does not reduce peak heap during canonical + scored alignment.
- **`build_shared_compare_compact_post_scored_sim_ready`** is a **late** observability marker; its **absence** in live logs is **expected** if the worker dies **before** line ~2676, and is **not** strong evidence of “marker too late” alone—it indicates **any** failure/OOM/timeout before that line.

**Exact recommended next code step (one narrow step)**

- **Introduce a compact-path-only bounded canonical build (or move slim immediately after the minimal inputs for scored+travel keys are known)** so the full-year canonical map and full `merged` spread of `buildCanonical…` output are **never** materialized at peak for `compareCoreMemoryReducedPath`—while preserving correctness for travel/vacant parity and scored-day alignment. (This targets the gap **before** `build_shared_compare_scored_row_keys_ready`.)

---

## 2) Files Inspected

| File | Purpose |
|------|---------|
| `modules/usageSimulator/service.ts` | `compareCoreMemoryReducedPath`, phases, post–`scored_sim_rows` allocations, slim/truncate, return graph |
| `app/api/admin/tools/gapfill-lab/route.ts` | `includeDiagnostics` / `includeFullReportText`, `selectedDaysCoreLightweight`, `buildGapfillCompareSimShared` args, timeout wrapper, snapshot/finalize |
| `tests/usageSimulator/service.artifactOnly.test.ts` | Phase presence / compact assertions (spot-check for test alignment section) |

*Note: `docs/CHAT_BOOTSTRAP.txt` and `docs/PROJECT_CONTEXT.md` were not required for code-truth sections of this audit and were not used as evidence.*

---

## 3) Compact Path Verification

### Service gating (`compareCoreMemoryReducedPath`)

```1206:1212:modules/usageSimulator/service.ts
  const compareCoreMemoryReducedPath =
    selectedDaysLightweightArtifactRead === true &&
    effectiveCompareFreshMode === "selected_days" &&
    !rebuildArtifact &&
    !autoEnsureArtifact &&
    includeDiagnostics !== true &&
    includeFullReportText !== true;
```

**Confirmed:** The flag is tied to the **parameter** `selectedDaysLightweightArtifactRead` from `args`, not `useSelectedDaysLightweightArtifactRead`.

### `compactPathEligible`

```1895:1896:modules/usageSimulator/service.ts
    compactPathEligible: compareCoreMemoryReducedPath,
```

**Confirmed:** Same boolean as `compareCoreMemoryReducedPath`.

### Route: arguments into `buildGapfillCompareSimShared`

```2131:2134:app/api/admin/tools/gapfill-lab/route.ts
  const compareFreshMode: "selected_days" | "full_window" =
    includeDiagnostics || includeFullReportText ? "full_window" : "selected_days";
  const selectedDaysCoreLightweight =
    compareFreshMode === "selected_days" && !includeDiagnostics && !includeFullReportText;
```

```2306:2318:app/api/admin/tools/gapfill-lab/route.ts
        buildGapfillCompareSimShared({
          ...
          autoEnsureArtifact: autoEnsureArtifactForCompare,
          compareFreshMode,
          includeFreshCompareCalc: compareFreshMode === "full_window",
          selectedDaysLightweightArtifactRead: selectedDaysCoreLightweight,
          includeDiagnostics,
          includeFullReportText,
```

**Confirmed:** Route passes **`includeDiagnostics`** and **`includeFullReportText`** from `body` (~1402–1403 in same file, per grep). **`selectedDaysCoreLightweight`** matches the service’s lightweight intent when both flags are false.

### Exact-parity selected-days + compact

**Confirmed in code:** `compareCoreMemoryReducedPath` does **not** require internal `useSelectedDaysLightweightArtifactRead`; exact travel parity clears that internal flag (~1147–1150) but the **caller** still passes `selectedDaysLightweightArtifactRead: selectedDaysCoreLightweight` as long as diagnostics/full report are off—so **exact-parity-required** requests **can** still satisfy `selectedDaysLightweightArtifactRead === true` from the route and enter the compact memory-reduced path.

---

## 4) Phase Marker Placement Review

### Where `build_shared_compare_compact_post_scored_sim_ready` is emitted

```2672:2682:modules/usageSimulator/service.ts
  if (compareCoreMemoryReducedPath) {
    if (exactParityArtifactIntervalsDecodeBufferOwned && exactParityArtifactIntervals.length > 0) {
      exactParityArtifactIntervals.length = 0;
    }
    await reportPhase("build_shared_compare_compact_post_scored_sim_ready", {
      compactScoredRowCount: boundedTestDateKeysLocal.size,
      compactParityRowCount: travelVacantParityRows.length,
      compactWeatherRowCount: scoredDayWeatherRows.length,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      missingDisplaySimCount: displayVsFreshParityForScoredDays.missingDisplaySimCount,
    });
  }
```

**Placement:** **After** `build_shared_compare_scored_rows_ready` (~2530), **after** `freshParityDailyByDate`, **after** `travelVacantParityRows` and **`travelVacantParityTruth`**, and **before** `build_shared_compare_parity_ready` (~2688).

### Relation to likely OOM allocations

- **`build_shared_compare_scored_sim_rows_ready`** fires at ~2265.
- The **next** logged phase in sequence would be **`build_shared_compare_scored_row_keys_ready`** (~2407) if execution continues.

**Conclusion:** `build_shared_compare_compact_post_scored_sim_ready` is **not** “right after” `scored_sim_rows`; it is **near the end** of the post-scored-sim pipeline. Its **absence** in live logs is **consistent** with:

1. **Process termination (OOM/timeout) before ~2676** — most likely if logs stop right after `scored_sim_rows`.
2. **`compareCoreMemoryReducedPath === false`** — would also skip this marker; **inconsistent** with logs that already show **`build_shared_compare_compact_compare_core_memory_reduced`** (that phase is also gated by `compareCoreMemoryReducedPath` at ~2253).

Therefore, if production logs include **`build_shared_compare_compact_compare_core_memory_reduced`** but **not** `build_shared_compare_compact_post_scored_sim_ready`, **branch mismatch for compact path is unlikely**; **early termination before line ~2676** is the straightforward explanation. **Undeployed code** cannot be ruled in or out from code alone—only from deployment/version evidence.

---

## 5) Post–`scored_sim_rows` Object Graph Review

**Reference line:** `await reportPhase("build_shared_compare_scored_sim_rows_ready", …)` ~2265.

Everything below runs **after** that phase until the next “later” markers (`scored_row_keys_ready`, etc.).

| Object / structure | What / why | Scope | Duplication / retention | Materiality |
|---------------------|------------|-------|-------------------------|-------------|
| `exactParityArtifactIntervals` | Full artifact 15m series or **decoded** cache copy for exact travel parity | Full series when truth path uses dataset intervals or decode | Same underlying truth as `artifactIntervalsRaw` when pointing at `dataset.series.intervals15`; **extra** array when decode path used | **High** when decode fills a full year of points |
| `artifactDatasetForExactParity` | Shallow `{ ...dataset, series: { … intervals15 } }` for canonical build | Full dataset shell + series | Shares references with `dataset`; not a deep clone of all nested arrays | Moderate (mostly structural) |
| `preservedMetaCanonicalTotals` | Read of meta canonical totals | Keys present in meta | Duplicate view of subset of truth | Low–moderate |
| `canonicalArtifactSimulatedDayTotalsByDate` | Output of `buildCanonical…` or `readCanonical…`, then merge/backfill | Often **full-window** ownership set before slim | **Merged** via `{ ...canonical }` spread (~2327) duplicates map before slim | **High** until slim (~2358) |
| Slim block (~2358–2374) | Retains only `boundedTestDateKeysLocal ∪ travelVacantParityDateKeysLocal` | Selected + parity dates | Reduces prior map; overwrites meta when exact parity | **Reduces** retained canonical |
| `artifactSimulatedDayReferenceRows` | Rows from slim canonical for display keys | Selected-days display keys | Small | Low |
| `simulatedChartDailySourceByDate` | Map from `simulatedChartDaily` | Display/scored dates | Low | Low |
| `freshDailyTotalsByDate` | Map from selected-day fresh totals or interval sum | Bounded test keys | Low | Low |
| `canonicalArtifactDailyByDate` | Map from `Object.entries(canonicalArtifactSimulatedDayTotalsByDate)` | After slim: small | Duplicates slim canonical in Map form | Low after slim |
| `parityDisplayDailyByDate` | Map built in loop over `boundedTestDateKeysLocal` | Scored test days only | Low | Low |
| `displayVsFreshParityForScoredDays` | Envelope object | Scored-day truth | Low | Low |
| `freshParityIntervals` (input to parity) | From earlier sim; not allocated here | Travel parity selection in selected-days path | Already live | — |
| `freshParityDailyByDate` | Aggregates all points in `freshParityIntervals` | Typically travel-date–scoped batches | One pass map | Low–moderate |
| `travelVacantParityRows` | One row per `travelVacantParityDateKeysLocal` | Parity dates | Low count | Low |
| `scoredDayWeatherRows` | Built earlier in selected-days weather path | Scored days | Retained for return | Low |
| Route: `accuracyTuningBreakdowns`, `missAttributionSummary`, `snapshotJson` | Assembled **after** `buildGapfillCompareSimShared` returns in `route.ts` | N/A | Not part of in-service OOM during `build_shared_compare` | **Post–compare** retention pressure if compare succeeds |

**`artifactIntervalsMaterializedCount` in compact phase meta** (~2257) reports **`artifactIntervals.length`**. In compact path, `artifactIntervals` is built by filtering **`artifactIntervalsRaw`** to **`boundedTestDateKeysLocal`** only (~1785–1797). So **1824** in logs is **not** the raw full-year series length by construction—it is the **filtered** materialized count (e.g. can be `96 ×` number of local scored days intersecting raw data). **Confirmed:** semantics depend on compact path actually being active (same gate as `compareCoreMemoryReducedPath`).

---

## 6) Verification of Latest Reductions

| Reduction | Implemented in code? | Early enough vs likely OOM after `scored_sim_rows`? |
|-----------|----------------------|---------------------------------------------------|
| Slim `canonicalArtifactSimulatedDayTotalsByDate` to scored ∪ travel parity keys | **Yes** (~2358–2374) | **Partially** — runs **after** decode + `buildCanonical…` + full `merged` spread |
| Overwrite `dataset.meta` / top-level canonical keys with slim map | **Yes** when `exactTravelParityRequiresIntervalBackedArtifactTruth` (~2369–2372) | Same timing as slim |
| Release owned `exactParityArtifactIntervals` decode buffer (`length = 0`) | **Yes** (~2673–2675) | **Too late** for peak between ~2298–2537 — only after travel parity uses the buffer |
| Emit `build_shared_compare_compact_post_scored_sim_ready` | **Yes** (~2676–2682) | **Observability only**; **late** in pipeline — does not bound earlier allocations |

---

## 7) Most Likely Remaining Hotspot (single primary)

**Primary:** The block **immediately following** `build_shared_compare_scored_sim_rows_ready` (~2292–2348): allocation of **`exactParityArtifactIntervals`** (including possible **full decode**), **`buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset`** over full interval ownership, and **`merged`** spread of the **full** canonical map—**before** slimming (~2358).

**Why:** This is the first large, post–`scored_sim_rows` spike that still runs on the compact path and occurs **before** any later phase logging (`scored_row_keys_ready`). It matches a failure mode where logs show `scored_sim_rows_ready` but nothing after.

---

## 8) Recommended Next Step (exactly one)

**Add a compact-path-only bounded construction path for canonical simulated-day totals** (or equivalent refactor that never materializes the full-year canonical object or full `merged` copy) for dates in `boundedTestDateKeysLocal ∪ travelVacantParityDateKeysLocal` **before** or **instead of** `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset` over the full artifact, while preserving interval-backed travel parity correctness and shared-window policy.

---

## Test alignment (review)

- **Current tests** (`service.artifactOnly.test.ts`): assert **`build_shared_compare_compact_post_scored_sim_ready`** appears in **compact** scenarios and bound **`artifactSimulatedDayReferenceCount`** — they **do not** prove **phase order vs peak memory** (e.g. that slim runs before a specific heavy allocation).
- **Gap:** No test asserts that **`build_shared_compare_scored_row_keys_ready`** follows **`build_shared_compare_scored_sim_rows_ready`** with **bounded** canonical key count **in the same run** under exact-parity + decode, or that peak structures are bounded by a function of test+parity dates only.

**High-value additions (one or two):**

1. **Order assertion:** In a compact + exact-parity + decode fixture, record phase order and assert **`build_shared_compare_scored_row_keys_ready`** occurs and **`canonicalArtifactSimulatedDayTotalsByDate` key count** (if exposed via modelAssumptions or meta) is ≤ `|boundedTest ∪ travelParity|` after slim.
2. **Meta / phase hook:** Assert **`build_shared_compare_compact_post_scored_sim_ready`** position relative to **`build_shared_compare_parity_ready`** (already after) and optionally add a **new** early compact marker after slim only in tests—**only if** product wants observability for “slim completed” (would be a future code change, not this audit).

---

*End of audit.*
