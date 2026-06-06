# Past weather parity + mode testing — agent bootstrap

**Created:** 2026-05-20 · **Branch:** `main` · **Status:** OPEN — GB Past weather cards diverge User vs Admin; sim totals already match.

**Parent handoff:** `docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md` (all modes). **This file:** GB Past weather ownership + proof rules.

---

## Paste block (copy everything below into a new Cursor chat)

```
You are taking over IntelliWatt mode-testing and Past weather parity work.

## REQUIRED FIRST STEP — read before coding

Read these in order and confirm in your first reply that you read them:

1. docs/PAST_WEATHER_PARITY_AGENT_BOOTSTRAP.md (this file — active bug + proof rules)
2. docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md (all-mode testing matrix + SMT/GB/MANUAL checklist)
3. docs/ONE_PATH_DUAL_RUN_GOAL.md (two runs, one pipeline — NOT artifact copy)
4. docs/CHAT_BOOTSTRAP.txt (house rules; follow, do not recreate)
5. docs/ONE_PATH_SIM_ARCHITECTURE.md
6. docs/USAGE_LAYER_MAP.md
7. docs/SURFACE_PARITY_OWNERS.md (includes Past weather bundle ownership)
8. docs/SMT_UNIFICATION_COMPLETE.md + docs/PROJECT_PLAN.md → PC-2026-05
9. docs/USAGE_INTERVAL_SOURCE_OF_TRUTH.md + docs/PROJECT_PLAN.md → PC-2026-08
10. docs/PROJECT_PLAN.md → PC-2026-09 (open Past weather parity)
11. .cursor/rules/one-path-dual-run-lock.mdc
12. .cursor/rules/smt-unification-lock.mdc
13. .cursor/rules/shared-sim-window-lock.mdc
14. .cursor/rules/usage-interval-ingest-lock.mdc

Then skim these code owners (do not implement until you state what is broken):

- lib/usage/weatherScoringOwnership.ts — bundle A/B/C matrix
- lib/usage/resolvePastVisibleWeatherScore.ts — shared Past visible resolver (shipped e2168768)
- lib/usage/userPastApiWeatherResponse.ts — User API + client guard
- lib/usage/finalizePastDatasetDisplayReadModel.ts — finalize + optional cache persist
- app/api/user/usage/simulated/house/route.ts — User Past read path
- app/api/admin/tools/one-path-sim/route.ts — Admin Past readback + finalize
- components/usage/UsageSimulatorClient.tsx — User visible cards (`resolvePastWeatherScoreFromHouseApiBody`)
- components/admin/OnePathRunReadOnlyView.tsx — Admin visible cards
- lib/usage/intervalReadModelInvariants.ts — `auditUserAdminPastReadModelParity` (KNOWN FALSE GREEN)

## What we are doing now

We are **testing every mode** end-to-end (Usage read path, One Path INTERVAL/GREEN_BUTTON/MANUAL baseline + Past Sim) for correct labels, data ownership, SMT lifecycle, analytics passthrough, and **visible weather card parity** on Past Sim.

Sim layer for the GB keeper house is largely aligned (net kWh, WAPE, TOD). **Weather cards are not.**

## Active bug — GB Past weather (Fort Worth keeper)

**User:** `bllfield32@icloud.com`
**Source house:** `0bbd25b6-9b8b-40ba-9382-dd85a1e1eda4`
**Pinned One Path test home:** `29a3d820-2593-4673-9dd6-cd161bbd7f6f`
**Past scenario name:** `Past (Corrected)` (user scenario `334ee842-96fd-4978-a837-faefebff5647`; admin test scenario `6cf87e23-c496-4e53-8657-b39566e5488d`)

### Current known visible outputs (three paths — NOT one)

| Path | Weather cards | Net kWh | WAPE / TOD | Trust level |
|------|---------------|---------|------------|-------------|
| **Visible User UI** (browser) | **50 / 97 / 73 / 100** | 14,460 | 10.28% · 3007/2964/4000/4489 | **PRIMARY User proof** |
| **Visible Admin UI** | **50 / 93 / 76 / 100** | 14,460 | matches User sim | **PRIMARY Admin proof** |
| **In-process tmp script** (`tmp-live-past-weather-proof.mjs`) | 44 / 100 / 79 | 14,460 after finalize | n/a | **INVALID — do not use as User truth** |

**Hard rule:** The only proof that matters for User Past parity is the **exact browser Network response** consumed by the visible User Past tab.

### Why the in-process 44/100/79 is NOT User truth

`scripts/tmp-live-past-weather-proof.mjs` User leg is **invalid** for visible User proof because it:

1. Ran **in-process**, not the authenticated browser network response.
2. Accidentally used **`allow_rebuild`** when `artifact_only` missed → **wrote a new prod artifact** on source house (`inputHash` `Z_WI8d9…`, `2026-06-06T09:29:47Z`).
3. Produced **44/100/79**, which **does not match** the current User UI (**50/97/73**).
4. Bypasses session/auth/client cache behavior.

**Do not** use 44/100/79 as truth. **Do not** force User → Admin until live User network response is captured.

### Weather bundle model (Past Sim)

| Bundle | Meta field | Role | Cooling/Heating on this house |
|--------|------------|------|-------------------------------|
| **A** | actual baseline | Not Past cards | n/a |
| **B** | `meta.weatherSensitivityScore` | Pre-sim / build diagnostic | **97 / 73** matches User UI cooling/heating |
| **C** | `meta.pastDisplayWeatherSensitivityScore` | Past **display** owner (post-finalize) | **93 / 76** matches Admin UI |

- Admin visible **50/93/76** = bundle **C** (`past_artifact_build`).
- User visible **50/97/73** = bundle **B** cooling/heating pattern — likely API returning B or client rendering stale/wrong nested field.

Weather scoring does **not** affect sim totals. Two artifacts can share 14,460 kWh but differ on B vs C.

### Shipped but insufficient fixes

| Commit | What it did | Why UI still diverges |
|--------|-------------|----------------------|
| `e2168768` | Shared `resolvePastVisibleWeatherScore` for User + Admin routes | Read-model wiring; does not unify separate artifact rows or prove live User browser path |
| `03d1b2b9` | Score with source-house profiles in finalize | User rejected diagnosis; profile sync may be incomplete anyway |

### Known false green — parity audit

`auditUserAdminPastReadModelParity()` in `lib/usage/intervalReadModelInvariants.ts` compares **the same admin in-memory dataset twice** (labels one side "user"). It **never** calls live `/api/user/usage/simulated/house`. AI copy `weatherCards.pass: true` at 50/93/76 is **not** cross-surface proof.

### Profile fingerprints (DB read, 2026-06-06)

| Scope | Fingerprint |
|-------|-------------|
| User + source house | `xedAsISfRmVDP-lv` |
| Lab owner + test home | `3loiDgvlsCU6shDj` |
| Lab owner + source house id | `uca1DmkMMrg5AwKb` |

`testMatchesUserSource: false` — profiles are **not** byte-identical in DB despite `syncOnePathMissingProfilesFromSource` on Admin lookup. Investigate before blaming "wrong house profile" vs "bundle read fork".

### Accidental prod side effect (warn user)

Proof script rebuilt user source Past artifact. Future audits: **read-only only**, **fail closed** if artifact missing — never `allow_rebuild` on prod.

---

## REQUIRED NEXT PROOF (before any fix)

Use **browser DevTools → Network** on the **actual User Usage Simulator Past tab** showing **50/97/73**.

Capture the **exact request** that feeds visible weather cards:

- request URL (confirm endpoint — may or may not be `/api/user/usage/simulated/house`)
- `houseId`, `scenarioId`
- response `weatherSensitivityScore` (top-level)
- response `dataset.meta.pastDisplayWeatherSensitivityScore` (bundle C)
- response `dataset.meta.weatherSensitivityScore` (bundle B)
- response `pastWeatherDiagnostics`
- response `weatherCardsSourceOwner`
- response `weatherReadPath`
- client cache key if present (React state / SWR / prior fetch)

### Decision tree

| Browser response vs UI | Conclusion |
|------------------------|------------|
| API returns **50/97/73**, UI shows **50/97/73** | User **route** returns wrong visible score (bundle B leak or wrong finalize) |
| API returns **50/93/76**, UI shows **50/97/73** | **Client** renders stale/wrong nested data (`UsageSimulatorClient.tsx`) |
| API returns **44/100/79**, UI shows **50/97/73** | Page not reflecting response OR UI paste is cached — reconcile carefully |
| Request is **not** `/api/user/usage/simulated/house` | Prior proof scripts tested the **wrong endpoint** |

Repeat for Admin: One Path readback response (or Network on Admin Past block) for **50/93/76**.

---

## Proof script rules (all future audits)

1. **Read-only** — `artifact_only` only; **fail closed** if artifact missing (exit non-zero, do not rebuild).
2. **No prod writes** — never `allow_rebuild`, never `persistDisplayWeatherToCache: true` in audit scripts.
3. **User proof = browser Network** — in-process User route mirrors are **supplemental** only, never decisive.
4. **Admin proof** — live HTTP with `persistRequested: false` is OK if test home has GB usage; if 409 `green_button_usage_missing`, document blocker and use last known good payload.
5. **Compare fields explicitly** — top-level, bundle C, bundle B, diagnostics, `weatherCardsSourceOwner`, `weatherReadPath`, `artifactInputHash`.
6. **Do not trust** `auditUserAdminPastReadModelParity` until it calls live User API.

---

## Mode testing matrix (all modes — ongoing)

Canonical end (Chicago, lag 2): verify with `resolveCanonicalUsage365CoverageWindow()` (currently `2026-05-18`).

| Surface | Mode | Run type | Pass criteria |
|---------|------|----------|---------------|
| User Usage | SMT | read-only actual | Persisted intervals; daily `source`/`sourceDetail`; tail kWh = full Chicago day |
| One Path Admin | INTERVAL | BASELINE_PASSTHROUGH | Same upstream truth as Usage; 15-min curve + analytics match |
| One Path Admin | INTERVAL | PAST_SIM | Dual-run on test home; sim totals/TOD/WAPE match user when inputs match |
| One Path Admin | GREEN_BUTTON | PAST_SIM | Dual-run; GB cache skip on same upload hash; **weather cards = User** (OPEN) |
| One Path Admin | MANUAL_* | baseline + Past | Stage 1 read + shared Past; no private baseline sim |

**SMT reference house:** `8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8` · ESIID `10400511114390001`
**GB Past reference:** `0bbd25b6-…` · user above

---

## Your first reply should include

1. Confirmation you read the required docs (list them).
2. Restate the three weather paths and which one is authoritative for User.
3. Plan to capture **browser Network** User response (or report blocker if you need user to paste it).
4. Table: mode × runType × pass/fail from latest **user-provided** payloads (not stale script output).
5. Root-cause hypothesis for **50/97/73 vs 50/93/76** (bundle B vs C fork).
6. Proposed fix plan — **wait for user "go"** after network proof unless they said fix it.

Do NOT implement fixes before browser Network proof for User Past weather.
```

---

## For the human

1. Open a **new Cursor chat**.
2. Paste the block above.
3. For User weather proof: open Usage Simulator → Past tab → DevTools Network → copy the response JSON for the request that loads scenario curves.
4. Optionally attach latest One Path AI copy JSON for Admin Past.

## Doc maintenance

When Past weather parity fixes land, update in the same pass:

- This file (known outputs + proof checklist)
- `docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md`
- `docs/SURFACE_PARITY_OWNERS.md` (weather bundles)
- `docs/PROJECT_PLAN.md` → PC-2026-09
- `docs/CHAT_BOOTSTRAP.txt` (pointer only)
- Fix `auditUserAdminPastReadModelParity` to call live User API or mark audit as admin-only
