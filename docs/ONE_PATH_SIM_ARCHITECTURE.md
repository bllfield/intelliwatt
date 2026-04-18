# One Path Sim Architecture

This document is the canonical written reference for the One Path Sim rescue architecture.

Use it to answer:
- what One Path Sim is right now
- what it is not yet
- what usage owns upstream
- what simulation owns downstream
- what weather owns
- what readers are allowed and not allowed to do
- what still remains pre-cutover

When this document conflicts with older planning or audit language, this document wins unless a newer authoritative override explicitly replaces it.

## Current state

- One Path Sim Admin is currently a **pre-cutover proving harness / truth console**.
- It is the place to define, inspect, and verify the canonical shared simulation architecture.
- It is **not yet** the live source of truth for all existing simulation-facing surfaces.
- Existing GapFill, user Past/manual pages, and other readers are **not yet fully rerouted** just because One Path exists.
- Existing live app surfaces remain quarantined from One Path. GapFill, user sim pages, and the normal usage flow are still on their current live/shared paths; Manual Lab now shares the One Path-owned Stage 2 Past calc/read path but remains a separate admin Stage 1 surface.
- Current verified repo state: `modules/onePathSim/**` is now internally sealed from live behavior-owner imports under `modules/usageSimulator/**`, `modules/manualUsage/**`, `modules/weatherSensitivity/**`, and `modules/simulatedUsage/**`.
- That internal seal does **not** mean cutover is complete. One Path may still depend on safe pure utilities and read-only data access outside `modules/onePathSim/**`, but it is not allowed to depend on live behavior owners.
- This phase is about locking ownership and contracts so later cutover can happen without drift.

## Non-negotiable upstream / downstream boundary

### Usage stays upstream

- The existing usage page / usage pipeline remains the upstream source of truth for usage data and usage curve production.
- Simulation starts only **after** usage truth exists.
- One Path baseline must reuse persisted upstream usage truth for that mode instead of simulating a baseline.
- When persisted upstream usage truth is missing, baseline may request the existing shared usage refresh/orchestration owner, then retry the persisted read.
- One Path Sim must **not** become a new upstream usage producer.
- This architecture does **not** redesign, replace, or disconnect the current usage page flow.

### Simulation stays downstream

- Simulation consumes upstream usage truth plus normalized mode-specific raw input.
- Simulation does not own upstream usage creation.
- Simulation must not privately reinterpret raw usage before the existing usage flow has produced canonical usage truth.

## Canonical shared producer pipeline

The canonical One Path simulation pipeline is:

`raw input -> shared adapter -> CanonicalSimulationEngineInput -> shared simulation core -> shared post-sim formatter -> persisted CanonicalSimulationArtifact -> CanonicalSimulationReadModel`

Rules:
- Baseline is outside this simulation pipeline. Baseline is usage passthrough only and must not privately enter the shared simulation core.
- Past Sim is the first place the shared simulation core and final chart/output structuring are allowed to run.
- Raw input may differ by mode or caller.
- Adapter behavior may differ by mode before the engine input is finalized.
- After `CanonicalSimulationEngineInput`, the path is shared.
- No caller-specific simulation core is allowed after the adapter boundary.
- No page-local or route-local post-sim formatter is allowed after the shared formatter boundary.

## Canonical shared contracts

The architecture owns one canonical simulation contract family:

- `CanonicalSimulationEngineInput`
- `CanonicalSimulationArtifact`
- `CanonicalSimulationReadModel`

Rules:
- Future readers must read the same persisted artifact family.
- Future readers must consume the same read model / output contract.
- Readers must not recompute core simulation outputs.
- Readers must not privately reshape parity, compare, chart series, source truth, or artifact identity.
- Readers may project or format shared read truth for display, but they must not become second truth owners.

## Supported modes

The architecture supports four modes inside the same shared design:

- `INTERVAL`
- `MANUAL_MONTHLY`
- `MANUAL_ANNUAL`
- `NEW_BUILD`

Rules:
- These modes may differ in raw input and adapter normalization only.
- Everything after `CanonicalSimulationEngineInput` belongs to the same shared downstream architecture.
- Mode-aware behavior belongs in shared adapters, shared variable/config resolution, and shared diagnostics, not private caller forks.

## Weather ownership

Weather remains under one shared owner.

Rules:
- Exactly two weather scoring paths only:
  - `INTERVAL_BASED`
  - `BILLING_PERIOD_BASED`
- No third weather scoring path is allowed.
- No caller-based weather branches are allowed.
- No page-local or route-local weather math is allowed.
- `weatherEfficiencyDerivedInput` is consumed only inside the shared calculation path.
- `weatherEfficiencyDerivedInput` acts as a shape modifier, not a target setter.
- For `MANUAL_MONTHLY` and `MANUAL_ANNUAL`, weather-driven amplitude must remain compressed relative to interval-backed mode so bill-target / parity ownership remains authoritative.

## Manual monthly rule

- GapFill monthly, Manual Lab monthly, user manual monthly, and One Path monthly must ultimately use the same shared manual-monthly calculation logic.
- No caller-specific calculation behavior is allowed.
- No route-local post-sim formatter is allowed.
- No page-local shaping differences are allowed.
- Bill totals / parity remain authoritative.
- Differences in Stage 1 entry/editor workflow do not justify differences in Stage 2 shared simulation logic.
- Manual monthly and manual annual baseline are still passthrough-only stages. They may reuse saved manual truth/read-model wrappers, but they must not simulate or become the first place final chart structuring happens.
- One Path manual Stage 1 display must be published from One Path-owned wrappers/read models under `modules/onePathSim/**`; it must not reuse the current user manual page as a behavior/display source of truth.
- For manual modes, the lean read path should return the same manual Stage 1 contract plus the same Stage 2 display-ready readback the future lightweight user-style manual path will use; debug-only surfaces may add diagnostics, but not a second core operation.

## GapFill source-home rule

- GapFill source home should be read-only from the persisted shared artifact / read model.
- GapFill source home must not own private source-home simulation behavior.
- GapFill may expose read-only diagnostics or compare views, but it must not introduce a separate source-home producer or formatter.

## Current verified isolation status

- One Path is still **pre-cutover only**.
- One Path is **externally quarantined** from live consumer surfaces.
- One Path is also now **internally sealed** against live behavior-owner imports from the old shared sim/manual namespaces listed above.
- The active upstream truth owner inside One Path is `modules/onePathSim/upstreamUsageTruth.ts`.
- Current verified baseline behavior is **usage passthrough first**: One Path reads persisted upstream usage truth, may request the existing shared usage refresh/orchestration owner when truth is missing, and still fails if that upstream truth cannot be obtained.
- Current verified baseline behavior is also **non-simulating**: baseline does not run synthetic dataset packaging, does not build a direct simulated dataset, and does not become the first final-chart structuring stage.
- This document must describe the verified code state, not an older intended state.

## Variable tuning ownership

- The shared simulation variable policy is the tuning/config owner.
- Variable families are mode-aware.
- `effectiveSimulationVariablesUsed` must be surfaced from the canonical read model for the exact run identity.
- Future tuning should primarily happen through shared variables/config, not scattered logic edits.
- This does **not** guarantee that every hardcoded coefficient has already been migrated; docs and implementation should state migration status honestly instead of assuming completion.

## One Path Sim Admin purpose

One Path Sim Admin exists to expose shared simulation truth before cutover. It should surface:

- inputs
- known-house sandbox scenario presets/expectations for repeated tuning runs
- adapter decisions
- upstream usage truth
- shared derived inputs
- effective variables used by run
- chart/window/display owners
- manual statement / annual owners
- donor / fallback / exclusion logic
- intraday reconstruction logic
- constraint / rebalance logic
- artifact / read-model truth
- compare / parity / tuning truth
- manual Stage 1 contract truth for `MANUAL_MONTHLY` and `MANUAL_ANNUAL`
- manual Stage 2 Past display truth through the same display-ready contract used by the lean path when supported

It is a proving harness and truth console. It is not yet proof that all other readers have been cut over.

Known-house scenario rule:
- repeated tuning runs should use a sandbox-only, code-backed scenario registry inside `modules/onePathSim/**`
- the registry may preload keeper-user email, house/context selection strategy, scenario selection strategy, validation inputs, travel ranges, expected truth source, and review expectations
- One Path Sim Admin may load those presets into the existing harness controls and attach the selected preset identity to sandbox summaries / AI copy payloads
- this registry is for pre-cutover operator repeatability only; it is not a live user-facing storage system and must not wire into live app surfaces

## Reader rules

Readers are allowed to:
- read persisted artifacts
- read canonical read models
- format shared truth for UI
- attach clearly read-only diagnostics or operator context

Readers are not allowed to:
- recompute core sim truth
- create alternate chart truth
- create alternate parity truth
- create alternate compare truth
- create alternate source-truth summaries
- create alternate weather scoring paths
- bypass persisted shared truth when a canonical artifact/read model already exists

## Future cutover sequencing

Current intended sequence:

1. Lock the architecture and truth surfaces in One Path Sim Admin.
2. Verify ownership boundaries, adapters, derived inputs, artifact contracts, read model contracts, and tuning visibility.
3. Remove or retire conflicting private behaviors in older surfaces as they are cut over.
4. Reroute readers to the same persisted artifact + read model family only when the shared path is fully proven.

Until that cutover is explicitly completed:
- old surfaces are not assumed to be fully migrated
- docs must not imply full cutover
- new work must not introduce fresh private sim paths

## Drift-prevention rule

The following must never drift again:

- usage remains upstream and simulation remains downstream
- one shared producer pipeline after adapter normalization
- one shared artifact contract
- one shared read model
- one shared weather owner
- exactly two weather scoring paths
- no reader-owned recompute of simulation truth
- no private source-home behavior
- no caller-specific manual-monthly calculation behavior

## Lockstep workflow rule

Any structural change to simulation ownership, module boundaries, orchestration, cutover state, upstream/downstream truth ownership, or lockbox isolation must update the relevant project docs and plan files in the **same pass**.

Required same-pass work:
- code change
- docs/plan sync
- stale-reference audit
- explicit conflict report when docs, plans, and code disagree

No code-only architecture changes are allowed.
