# One Path vs user-site Past run parity audit (2026-06-04)

**Trigger:** User-site Usage Simulator and One Path Admin both show Green Button Past, but validation WAPE, annual kWh, trusted-day pool, and sim kWh on validation days differ.

**Verdict:** These were **not** the same logical run. Same engine, different persistence targets, different build identity, and (before fix) test home did **not** refresh Past build inputs from the source house before admin Past recalc.

---

## Product rule (non-negotiable)

**One Path must not require users to open the Usage Simulator portal first.**

On lookup and before each admin INTERVAL/GB Past run on a pinned test home:

1. **Read** linked source house state from the user DB (profiles, scenario events, travel, SMT/GB actual).
2. **Refresh** test-home Past build inputs (mirror persisted user-site build when present; otherwise **seed** from source DB).
3. **Run** the shared Past pipeline on the **test home only** (`dispatchPastSimRecalc`).

Never persist sim/build/artifacts on the **source** house from One Path.

---

## What the Vercel logs show

### User site (source home)

| Field | Value |
|--------|--------|
| `houseId` | `0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4` |
| `userId` | `cmkrbr7nc0009jm047kk47ve3` |
| `scenarioId` | `334ee842-96fd-4978-a837-faefebff5647` |
| `artifactInputHash` | `W_QYIWB71WNUE9TKpwm8sUlKNVBGKMR_Dyy5u90chUQ` |
| Path | `getSimulatedUsageForHouseScenario` → cache miss → `simulatePastUsageDataset` |
| Trusted reference days | **19** |
| Incomplete-meter excluded days | **331** |
| Annual total (stitch) | ~**14,893** kWh |

### One Path admin (this run — **Green Button** preset, not INTERVAL)

| Field | Value |
|--------|--------|
| `houseId` | `29a3d820-2593-4673-9dd6-cd161bbd7f6f` (test home) |
| `userId` | `cmkjaxudm0002ky0450pl2opa` (lab owner) |
| `scenarioId` | `38110646-3cba-4192-8d23-16cb9e8316da` |
| `recalc_start.preferredActualSource` | **GREEN_BUTTON** (expected for GB mode) |
| `artifactInputHash` | `dMrcM7ZPBBQ2yJeLV1wIoewrPfSEcxr5XSOfqG5fh5s` |
| Path | `adapt_green_button_raw_input` → `dispatchPastSimRecalc` |
| Trusted reference days | **21** |
| Incomplete-meter excluded days | **329** |
| Annual total (stitch) | ~**14,771** kWh |

**Different `artifactInputHash` ⇒ different Past build identity.** Outcomes are allowed to differ until inputs + upstream truth match and both recalc.

---

## Why UI numbers diverge (not “random engine drift”)

1. **Different `houseId`** — Dual-run design: user persists on source; One Path persists on test home.

2. **Different `scenarioId`** — Admin preset uses workspace Past on the **test** home; compare via mirrored/seeded **build inputs**, not scenario uuid equality.

3. **Stale test-home build inputs** — Fixed: `ensureOnePathPastBuildInputsFromSource` on lookup + before admin Past run.

4. **Trusted pool 19 vs 21** — GB actual context / clone staleness or different validation pools.

5. **INTERVAL vs GREEN_BUTTON** — INTERVAL runs must log `preferredActualSource: SMT` and `actualContextHouseId` = linked **source**.

---

## Comparison procedure

1. **One Path lookup** on the source email (refreshes profiles, SMT on source, seeds/mirrors Past build inputs).
2. **One Path run** with the same mode as the comparison (INTERVAL → SMT; GREEN_BUTTON → GB).
3. Optionally recalc user site Past on the source for a second independent run; **not** a prerequisite for One Path.
4. Compare validation table, annual kWh, trusted-day count, `parityInputHash` / build snapshot.

---

## Fix shipped

- **`lib/usage/onePathPastBuildInputsSeedFromSource.ts`**: When source has no `UsageSimulatorBuild`, synthesize Past build inputs from source DB (profiles, events, travel, actual) and persist on test home only.
- **`ensureOnePathPastBuildInputsFromSource`**: Mirror when user-site build exists; else seed. No 409 for missing user-site Past build.
- **`app/api/admin/tools/one-path-sim/route.ts`**: Sync on lookup + before `dispatchPastSimRecalc`; log `one_path_past_build_inputs_sync`.
- **`298e7a5d`**: Usage shape on test `houseId`; lock `SMT` for `one_path_admin_past_run`.

---

## What still does *not* auto-match

- Different `artifactInputHash` on different `houseId` (expected until both sides recalc with matching inputs).
- Stale GB clone on test home after source upload — **Replace** test home or re-clone GB before GB Past compare.
