# Past weather parity — agent bootstrap

**Created:** 2026-05-20 · **Closed:** 2026-06-06 · **Branch:** `main` · **Status:** **COMPLETE (green)** — GB Past cross-surface weather input parity accepted.

**Parent handoff:** `docs/MODE_TESTING_HANDOFF_BOOTSTRAP.md`. **Tracker:** `docs/PROJECT_PLAN.md` → PC-2026-09.

---

## Acceptance record (2026-06-06)

Post-deploy visible checks on Fort Worth GB keeper:

| Check | Result |
|-------|--------|
| User Past weather | 50 / 97 / 73 / 100 (bundle C) |
| Admin Past weather | 50 / 97 / 73 / 100 (bundle C) |
| Net usage | 14,459.8 / 14,460 kWh |
| TOD | unchanged |
| WAPE | 10.28% unchanged |
| User artifact | source-profile stamped (`profileHouseId` = source house) |
| User recalc | `actualContextHouseId` = source house |

**Authoritative pass/fail:** read-only acceptance proof — not visible score match alone.

```bash
PROOF_AUDIT_ONLY=1 npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs
```

Requires `pastWeatherCrossSurfaceParity.ok === true` and `acceptanceProof.ok === true` in `scripts/tmp-prod-past-weather-parity-proof-output.json`.

Shipped: `32cc85d0`, `5abd8197`, `fd1de033`.

---

## Regression only (do not reopen weather debugging unless proof fails)

1. Run `PROOF_AUDIT_ONLY=1` proof after any change to Past weather finalize, cross-surface audit, One Path profile/fingerprint persist, or admin read-only finalize.
2. Never accept score-only parity — gates include `finalizedDailyRowsHash`, `displayTruthRevision`, profile/`usageShapeProfileIdentity`, and related input fingerprints.
3. Read-only admin/proof runs: `persistDisplayWeatherToCache: false`; no cache `updatedAt` bumps from proof.
4. Controlled recalc (when needed): `scripts/tmp-local-recalc-one-path-gb-past.mjs` with source `actualContextHouseId`; may also recalc user source if artifacts stale after sim version bump.

**Deprecated for User proof:** `scripts/tmp-live-past-weather-proof.mjs` (rebuild risk).

---

## Historical context (pre-close)

Before 2026-06-06, User visible showed bundle **B** cooling/heating (97/73) while Admin showed bundle **C** (93/76) despite matching sim totals. Root cause: test-home artifacts stamped test-home profile/usage-shape identity while display finalize used synced source profiles → score match with input mismatch. Fixes: source `profileHouseId` on persist, cross-surface raw artifact compare, source WholeHome fingerprint resolution on One Path recalc, read-only finalize guard.

For the full pre-close investigation notes, see git history of this file before 2026-06-06.

---

## Doc maintenance

If acceptance proof fails after a regression, update PC-2026-09 and this file in the same pass. Do **not** mark green from visible cards alone.
