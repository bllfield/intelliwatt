# Upgrade Ledger Overlay — Sanity Check

Run these checks before trusting overlay-driven plan costing.

---

## 1. Delta field write path (V1 contract)

**Risk:** Overlay reads `monthlyDeltaKwh` / `annualDeltaKwh` (V1 contract). The DB stores `deltaKwhAnnualSimulated`, `deltaKwhMonthlySimulatedJson` (and optional `impactJson`). If the UI never writes these, overlays apply 0 and users think upgrades “don’t work.”

**Verified:**
- `getV1DeltaFromLedgerRow` (impact.ts) maps DB fields → V1: `deltaKwhMonthlySimulatedJson` (e.g. `{ uniform: number }` or `{ value: number }`), `deltaKwhAnnualSimulated`, and optional `impactJson`.
- Create/update ledger API and repo now accept and persist `deltaKwhMonthlySimulatedJson` and `deltaKwhAnnualSimulated` (types.ts, repo.ts).

**Action:** Ensure when a user edits an upgrade, the UI or a backend calculator writes at least one of:
- `deltaKwhMonthlySimulatedJson` (e.g. `{ uniform: 200 }` for +200 kWh/month), or
- `deltaKwhAnnualSimulated` (fallback; distributed by baseline share).

Until the UI sends these (or a job backfills them), overlay deltas will remain 0 for user-created rows.

---

## 2. Fallback: no UPGRADE_ACTION in event-based overlay

**Risk:** Falling back to `computeMonthlyOverlay` when there are no ledger entries could reintroduce old behavior and apply UPGRADE_ACTION events as month-only, causing split-brain (ledger path = full-year/forward, fallback = month-only).

**Verified:** In `modules/usageScenario/overlay.ts`, `computeMonthlyOverlay` explicitly skips all events that are not `MONTHLY_ADJUSTMENT`:

```ts
if (kind && kind !== "MONTHLY_ADJUSTMENT") continue;
```

So UPGRADE_ACTION is never applied in the fallback path. Fallback is safe for MONTHLY_ADJUSTMENT only.

---

## 3. Effective date precision (month vs day)

**Risk:** Overlay uses month ranges; DB/store may have `effectiveDate` / `effectiveEndDate` as YYYY-MM-DD. Inconsistent conversion could mis-apply or drop months.

**Verified:**
- `effectiveMonth` for an entry comes from event `effectiveMonth` or `row.effectiveDate` → YYYY-MM (e.g. `effectiveDate.slice(0,7)` or `toYearMonth(row.effectiveDate)` in overlayEntries).
- End month: `effectiveEndDate` is normalized with `.trim().slice(0, 7)` in overlay (Past/Future). So YYYY-MM-DD → YYYY-MM; if user picks an end date mid-month, V1 applies the **full** end month (documented in overlay.ts comments).

---

## 4. No double-counting (one row → one entry)

**Risk:** A ledger row that matches both `scenarioId` and `scenarioEventId` could be emitted twice (once per match).

**Verified:** In `buildOrderedLedgerEntriesForOverlay`, each row is identified by `row.id` and added to a `used` set. A row is either consumed in the event loop (first match: by `ledgerId` or `scenarioEventId`) or in the “remaining” pass, never both. So each ledger row produces at most one overlay entry.

---

## 5. Interval placement vs plan costing

**Risk:** Spec mentioned `dailyDeltaShape96` / schedules for interval placement; if plan costing uses 15-min intervals (TOU), missing placement could distort TOU rates.

**Verified:** The simulator pipeline today:
- Builds **monthly** totals (with overlay adders applied in service.ts).
- Feeds `monthlyTotalsKwhByMonth` into the engine; the engine distributes to 15-min intervals using an intraday shape (flat or derived). Plan costing uses `estimateTrueCost` with annual/monthly or bucket usage derived from that curve.

So for V1, overlay only needs to contribute to **monthly** totals; the engine handles distribution to intervals. When TOU or shape-based deltas are required, that will be a separate step (dailyDeltaShape96 / schedules in impact.ts are prepared but not yet applied to intervals).

---

## Minimum test matrix (run before release)

| Case | Setup | Expectation |
|------|--------|-------------|
| **Past, permanent** | Add EV in Dec (no end date), delta +200 kWh/month | All 12 canonical months increase by 200. |
| **Past, temporary** | “Airbnb rental” Jun–Aug, delta +300 kWh/month | Only Jun, Jul, Aug increase. |
| **Future, permanent** | Add EV in Mar (no end date), delta +200 kWh/month | Mar through end of window increase; months before Mar unchanged. |
| **Future, temporary** | Pool pump Jun–Aug, delta +150 kWh/month | Jun, Jul, Aug only (from effectiveMonth forward). |
| **Orphan safety** | Ledger row ACTIVE, scenarioId set, no scenarioEventId | Either (a) not applied if rule is “must have scenarioEventId”, or (b) applied once in “remaining” pass if rule is “scenarioId + ACTIVE sufficient”. Current rule: scenarioId + ACTIVE is sufficient; unlinked row appears in remaining and is applied once by effectiveDate order. |

---

## File reference

- **V1 delta extraction:** `modules/upgradesLedger/impact.ts` — `getV1DeltaFromLedgerRow`
- **Ledger create/update (delta fields):** `modules/upgradesLedger/types.ts`, `modules/upgradesLedger/repo.ts`
- **Overlay logic:** `modules/usageScenario/overlay.ts` — `computePastOverlay`, `computeFutureOverlay`, `computeMonthlyOverlay`
- **Entry building (no double-count):** `modules/upgradesLedger/overlayEntries.ts` — `buildOrderedLedgerEntriesForOverlay`
- **Service wiring (fallback comment):** `modules/usageSimulator/service.ts`
