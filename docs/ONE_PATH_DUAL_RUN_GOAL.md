# One Path dual-run goal (canonical — read before any Past / lab-home work)

**Status:** Product requirement (authoritative).  
**When this conflicts with older “artifact copy parity” language or code, this document wins.**  
**Related:** `docs/ONE_PATH_SIM_ARCHITECTURE.md`, `docs/SURFACE_PARITY_OWNERS.md`, `.cursor/rules/one-path-dual-run-lock.mdc`

---

## What One Path is for

One Path Sim Admin is a **pre-cutover regression harness** for the **same** simulation engine and pipeline the user site uses. Operators load a real customer home, optionally change inputs on the lab test home, and verify that:

- the **shared** Past / manual / interval simulation logic is correct, and  
- admin runs **match** user runs when inputs and upstream usage truth are the same.

One Path is **not** a shortcut to display the user’s last saved Past artifact. It is **not** a second simulator. It is **two executions of one pipeline** with different persistence targets.

---

## Non-negotiable model: two runs, one pipeline

| Layer | User site | One Path (pinned lab test home) |
|--------|-----------|----------------------------------|
| **Purpose** | Production Past / usage for the customer | Admin lab: tune engine, compare to user |
| **`houseId`** | Source (user) home | `ONE_PATH_LAB_TEST_HOME` only |
| **Writable sim artifacts** | User home DB rows only | Test home DB rows only |
| **Source home** | N/A | **Read-only** — never persist sim/build to source |
| **Upstream SMT / usage** | `ensureSmtCoverage` + usage DB on source meter | **Same** ingest owner on **linked source** house (ESIID + auth), not a private One Path pull stack |
| **Past execution** | `recalcSimulatorBuild` → `simulatePastUsageDataset` → cache on **user** home | **Same functions** → cache on **test** home |
| **When inputs + usage truth match** | Artifact A | Artifact B — **must match** (hash/totals/curves), not “copied from A” |
| **When admin edits variables** | Unchanged | Artifact B **may** differ — intentional |

```text
                    ┌─────────────────────────────────────┐
                    │  Shared upstream (usage truth)       │
                    │  ensureSmtCoverage, actual dataset,  │
                    │  interval fingerprint, GB clone…   │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
    ┌─────────────────────┐                         ┌─────────────────────┐
    │ Run 1 — user home   │                         │ Run 2 — test home   │
    │ same build identity │                         │ same build identity │
    │ (userSiteIsolation) │                         │ (mirrored inputs)   │
    │ same Past engine    │                         │ same Past engine    │
    └──────────┬──────────┘                         └──────────┬──────────┘
               ▼                                               ▼
    PastSimulatedDatasetCache                         PastSimulatedDatasetCache
    (user houseId)                                    (test houseId)
```

**“Parity”** means **outcome equality** when inputs are equal, proved by **running both sides**, not by **copying** one cache row to the other.

---

## What “same run” means (inputs)

Two runs are the **same** when all of the following align (see `lib/usage/pastArtifactIdentity.ts`):

- Past build inputs (mode, travel/vacant, validation policy, weather preference, etc.)
- Canonical 365-day window (`resolveCanonicalUsage365CoverageWindow()`)
- **Interval data fingerprint** (changes after SMT backfill / GB refresh)
- Usage-shape profile identity (non–manual-totals modes)
- Weather identity
- Engine version
- Same **actual context** / preferred source resolution rules as the user route (`userSiteIsolation` semantics on the **source** identity, not ad-hoc admin-only hash paths)

If SMT backfill adds intervals, the fingerprint changes → **both** sides must **recalc** Past. Serving an old user artifact on the test home is **wrong**.

---

## Correct admin flow (target behavior)

### 1. Load / lookup

- Pin or replace test home from source (profiles, scenarios, GB clone as today).
- Run **`ensureSmtCoverageForHouse`** against the **linked source** house (`resolveOnePathAdminSmtHealTarget`) so usage DB matches what the user refresh would pull.
- **Do not** treat “parity” as “copy user Past cache to test home” on load.

### 2. One Path Past run (default — admin did not dirty inputs)

1. Mirror user Past **build inputs** onto the test home (or read them from synced build record with **identical** normalization to user recalc).
2. **`recalcSimulatorBuild` / `getPastSimulatedDatasetForHouse`** on the **test** `houseId` with the **same** engine path as `/api/user/simulator/recalc`.
3. Persist **new** artifact on **test** home only.
4. Optionally compare to user home artifact at the same `inputHash` — expect match.

### 3. User Past run

- Same pipeline on **user** `houseId`; persists on user home only.

### 4. Admin changed a variable (home, appliances, travel/vacant, validation, etc.)

- Test home inputs diverge → test home **recalc** → new `inputHash` → results **may** differ from user. That is the lab feature.

---

## Forbidden interpretations (do not build or extend these)

| Wrong approach | Why |
|----------------|-----|
| **Default: copy** `PastSimulatedDatasetCache` from user → test | Skips the run under test; hides engine bugs; freezes stale output after backfill |
| **Admin Past “run” = readback only** without recalc when inputs/data changed | Not a simulator run |
| **Recalc with unchanged inputs → re-copy from user** instead of re-sim on test | Same as copy |
| **Block test-home** `getPastSimulatedDatasetForHouse` when parity lock set | Prevents the second run entirely |
| **Second SMT ingest stack** under `modules/onePathSim` | Violates usage-upstream boundary |
| **Persist sim/build to source home** from One Path | Violates lab isolation |

Display-only sharing (e.g. `resolvePastSimFifteenMinuteCurveFromDataset`) is fine — that is **read projection**, not substituting for the sim run.

---

## Implementation status (SMT Past — 2026-05-20)

**Shipped toward dual-run (INTERVAL / SMT Past admin run):**

- Admin `action: run` + `mode: INTERVAL` + Past `scenarioId` → `dispatchPastSimRecalc` on **test home** (`callerLabel: one_path_admin_past_run`), then readback at `canonicalArtifactInputHash`.
- Removed: pre-read artifact copy, `unchangedParity` recalc sync, `parityLock` cache pinning, `parityLockRebuild` sim block, copy heal on read.
- Test-home replace → `mirrorOnePathPastBuildInputsFromSource` (build inputs only).

**Green Button Past (shipped 2026-05-20):**

- Admin `GREEN_BUTTON` + Past `scenarioId` → dual-run on test home via `dispatchPastSimRecalc` (`one_path_admin_gb_past_run`).
- **Cache-first:** if test-home cache already matches current GB `inputHash` (same upload / unchanged intervals), skip recalc and read artifact only (`lib/usage/onePathGbPastArtifactRun.ts`).
- **SMT contrast:** INTERVAL Past admin run always recalcs (backfill may change intervals without UI edits).

**Still deprecated:**

- `syncOnePathPastUserSiteParityFromSource` (full artifact copy) — do not add callers.

**Audits:** `docs/ONE_PATH_DUAL_RUN_SMT_PAST_AUDIT.md`, `docs/ONE_PATH_DUAL_RUN_GB_PAST_AUDIT.md`

| Module | Role today | Target |
|--------|------------|--------|
| `lib/usage/onePathPastUserSiteParity.ts` | Copy + lock | Input mirror + optional **verify** only; no default artifact clone |
| `lib/usage/onePathPastUserSiteParityLock.ts` | Dirty detection | Keep — “admin changed inputs since mirror” |
| `app/api/admin/tools/one-path-sim/route.ts` | Lookup heal + readback | Past **run** must invoke same recalc as user |
| `modules/onePathSim/usageSimulator/service.ts` | `unchangedParity` → sync | `unchangedParity` → **recalc on test home** |

---

## Lab home ops (single-occupancy by source family)

Because GB and SMT currently share the same mutable lab home, the latest dual recalc determines what the admin/test leg contains. The lab home is single-occupancy by source family; GB recalc invalidates SMT lab proof state and SMT recalc invalidates GB lab proof state. Always run the source-specific dual recalc immediately before that source's acceptance proof.

- Green Button proof is valid only after `scripts/audit/recalc-gb-dual-past.mjs`.
- SMT proof is valid only after `scripts/audit/recalc-smt-dual-past.mjs`.
- Cross-source stale lab artifacts → `STALE_LAB_HOME_SOURCE_FAMILY` in proof output (not a parity-code regression).

---

## Cross-surface acceptance: `resolvedSimFingerprint` (dual-run)

resolvedSimFingerprint may differ between source and lab artifacts because it is house-local. Cross-surface acceptance does not waive parity. It compares canonical display/weather truth instead: finalizedDailyRowsHash, displayTruthRevision, Bundle C, TOD/monthly read-model parity, weather hash, profile identity, usage shape identity, validation/travel-vacant fingerprints, scorer/calculation versions, and source interval/trusted-date fingerprints.

**Standard:** House-local artifact fingerprint may differ. Canonical display/weather truth fingerprints must match. If canonical truth does not match, fail closed.

- **Not acceptance:** visible score parity alone; `resolvedSimFingerprint` match alone; unexplained `"differs but accepted"`.
- **Audit owner:** `lib/usage/pastCrossSurfaceResolvedSimFingerprintPolicy.ts`, `lib/usage/pastWeatherInputParity.ts` (`crossSurfaceWeatherInputsOnly`), `acceptanceProof.resolvedSimFingerprint` in proof output.

---

## Baseline vs Past (do not conflate)

| Run type | Sim? | Dual-run rule |
|----------|------|----------------|
| **Usage dashboard** | No — persisted actuals | Same contract as One Path baseline passthrough |
| **One Path BASELINE / INTERVAL passthrough** | No | Same upstream truth as Usage |
| **Past (Corrected)** | Yes — shared Past engine | **Dual-run** applies (this doc) |

---

## Agent checklist (before changing One Path Past)

1. Read this file and `.cursor/rules/one-path-dual-run-lock.mdc`.
2. Will the change run **`simulatePastUsageDataset`** on the test home for a normal admin Past run?
3. After SMT backfill, does the test home **recalc** (new fingerprint), not reuse an old `parityInputHash` copy?
4. Are user and test artifacts **only** equal because the engine matched, not because of `copyPastArtifactCacheRow`?
5. Is the source home still **write-isolated** for sim artifacts?
6. Update this file / `SURFACE_PARITY_OWNERS.md` / `PROJECT_PLAN.md` if behavior or drift status changes.

---

## Doc index (read order for new chats)

1. **`docs/ONE_PATH_DUAL_RUN_GOAL.md`** (this file) — product goal  
2. `docs/ONE_PATH_SIM_ARCHITECTURE.md` — harness architecture  
3. `docs/SURFACE_PARITY_OWNERS.md` — module owners  
4. `docs/SMT_UNIFICATION_COMPLETE.md` — SMT heal (shared with user)  
5. `.cursor/rules/one-path-dual-run-lock.mdc` — permanent agent constraint  
