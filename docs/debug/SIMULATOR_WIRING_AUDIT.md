## Simulator Wiring + Data-Flow Audit (Report Only)

**Repo**: `intelliwatt-clean`  
**Date**: 2026-02-19  
**Scope**: wiring/data-flow audit only (no curve math or feature work)

### Constraints honored

- **No feature work**: no engine changes, no new flows added.
- **No SMT JWT changes**: SMT remains droplet-only; no `/oauth/token`, no `client_credentials`.
- **Thin controllers + pure modules**: this report calls out boundary issues; it does not refactor.
- **Minimal fixes**: none applied during this audit (app runs locally).

---

### Step 0 — Local reproduction (what was actually run)

**Runtime**

- `node -v` → `v24.11.0`
- `npm -v` → `11.6.1`
- `npm run dev` → Next.js `14.2.30` (local `http://localhost:3000`)

**Install**

- `npm install` completed successfully and generated Prisma clients (per `scripts/prisma/generate-all.js`) for:
  - master (`prisma/schema.prisma`)
  - current-plan, usage, home-details, appliances, upgrades, wattbuy-offers, referrals

**Local probes (unauth session)**

- `GET /dashboard/api` returned `200` and rendered a sign-in gate (“Sign in to manage your usage connections.”). This is expected because it is a user/cookie-driven dashboard page.
- `GET /dashboard/usage/simulated` returned `307` redirect to `/login?redirect=/dashboard/usage/simulated`. The response payload includes a Next redirect stack referencing `app/dashboard/usage/simulated/page.tsx` (redirect is server-side).

**Observed redirect stack snippet (from the local response payload)**

```text
NEXT_REDIRECT;replace;/login?redirect=/dashboard/usage/simulated;307;
Error: NEXT_REDIRECT
    at getRedirectError (…/next/dist/client/components/redirect.js:49:19)
    at redirect (…/next/dist/client/components/redirect.js:60:11)
    at UsageSimulatorPage (…/app/dashboard/usage/simulated/page.tsx:80:66)
```

**Limitations of local reproduction**

- Most simulator endpoints are **cookie-authenticated** via `intelliwatt_user`. Without a real session cookie + seeded DB user/house, local reproduction primarily yields **401/307** rather than deeper module-DB errors.
- The **module DB failure modes** (Home Details / Appliances / Usage DB missing env) are still documented below because they are a major source of “Internal server error” in prod/preview when env is misconfigured.

---

### 1) Entry flows into the simulator

#### Entry flow: Manual

- **User action**: Usage Entry hub → “Manual Usage” card.
- **Route**: `app/dashboard/api/manual/page.tsx`
- **Behavior**:
  - If not signed in: `redirect("/login?redirect=/dashboard/usage/simulated")`
  - Else: `redirect("/dashboard/usage/simulated?intent=MANUAL#start-here")`
- **Simulator interpretation**:
  - `components/usage/UsageSimulatorClient.tsx` maps `intent=MANUAL` → `mode="MANUAL_TOTALS"` and opens the manual modal on mount.

#### Entry flow: New Build

- **User action**: Usage Entry hub → “New Build / No usage history” card.
- **Route**: `app/dashboard/api/page.tsx` renders `href="/dashboard/usage/simulated?intent=NEW_BUILD#start-here"`.
- **Simulator interpretation**:
  - `intent=NEW_BUILD` → `mode="NEW_BUILD_ESTIMATE"` and opens Home modal on mount.

#### Entry flow: SMT connected

- **User action**: Usage Entry hub → “Smart Meter Texas” card (`/dashboard/api/smt`)
- **Route**: `app/dashboard/api/smt/page.tsx`
- **Behavior**:
  - Manages SMT authorization + address/ESIID readiness.
  - **Does not redirect** into simulator.
- **How simulator is later entered**:
  - User navigates to `/dashboard/usage/simulated` directly (or via some other dashboard navigation outside this audit’s scope).
  - Simulator client then probes `/api/user/usage` to detect actual intervals and switches itself to actual-baseline mode.

#### Entry flow: Green Button upload

- **User action**: Usage Entry hub → “Green Button Upload” card (`/dashboard/api/green-button`)
- **Route**: `app/dashboard/api/green-button/page.tsx`
- **Upload component**: `components/dashboard/GreenButtonUtilitiesCard.tsx`
  - Gets signed droplet upload ticket: `POST /api/green-button/upload-ticket`
  - Uploads to droplet `ticket.uploadUrl`
  - Triggers refresh: `POST /api/user/usage/refresh`
- **Behavior**:
  - **Does not redirect** into simulator.
  - Like SMT: simulator is entered by directly opening `/dashboard/usage/simulated`.

#### Entry flow: Gap-fill actual (partial SMT/GB)

- **Spec exists**: `docs/plans/USAGE_SIMULATOR_WORKSPACES_V1_PHASE1.md` defines `intent=GAP_FILL_ACTUAL`.
- **Client support exists**: `components/usage/UsageSimulatorClient.tsx` recognizes `intent=GAP_FILL_ACTUAL` and maps it to `mode="SMT_BASELINE"`.
- **Missing wiring**:
  - No route in `app/dashboard/api/*` currently redirects to `/dashboard/usage/simulated?intent=GAP_FILL_ACTUAL`.
  - This is a **wiring gap** (not a feature proposal): the intent exists in client + spec but there is no entry-point that sets it.

#### Entry flow: Full actual (12 months SMT/GB)

- **Usage Entry gating**:
  - `app/dashboard/api/page.tsx` computes `hasActualData` via `fetchActualCanonicalMonthlyTotals(...)` and **disables** Manual + New Build cards when actual intervals exist.
- **Simulator behavior**:
  - On mount, simulator calls `GET /api/user/usage` and if the selected house has intervals it sets `mode="SMT_BASELINE"` (actual-baseline mode).

---

### 2) Simulator page call graph (client)

#### Server component: page entry

- **File**: `app/dashboard/usage/simulated/page.tsx`
- **Responsibilities**:
  - `loadUsageEntryContext()` (cookies → user → primary house)
  - Redirect unauth users: `redirect("/login?redirect=/dashboard/usage/simulated")`
  - If no house saved: render `SmtAddressCaptureCard` instead of simulator
  - Else: render `<UsageSimulatorClient houseId={houseAddress.id} intent={searchParams.intent} />`

#### Client component: on-mount/network sequence

**File**: `components/usage/UsageSimulatorClient.tsx`

On mount (and on relevant dependencies), it issues these requests:

- **(A) Detect actual usage baseline**
  - `GET /api/user/usage` (no-store)
  - Extracts the current house’s dataset:
    - `hasActualIntervals = intervalsCount > 0 AND series.intervals15.length > 0`
    - `actualSource = "SMT" | "GREEN_BUTTON" | null`
    - `actualCoverage = {start,end,intervalsCount}`
  - If actual intervals exist and intent is not MANUAL/NEW_BUILD:
    - switches `mode` to `SMT_BASELINE` (actual-baseline simulation mode)

- **(B) Scenarios list**
  - `GET /api/user/simulator/scenarios?houseId=...`
  - Stores `scenarios[]` (used to find the “Past (Corrected)” and “Future (What-if)” workspaces)

- **(C) Requirements**
  - `GET /api/user/simulator/requirements?houseId=...&mode=...`
  - Stores `canRecalc` and `canonicalEndMonth`

- **(D) Build availability (baseline + scenarios)**
  - `GET /api/user/usage/simulated/builds?houseId=...`
  - Stores `builds[]` with `scenarioKey`, `scenarioId`, `lastBuiltAt`, etc.

- **(E) Scenario dataset for curve preview**
  - When `curveView` is `PAST` or `FUTURE`:
    - `GET /api/user/usage/simulated/house?houseId=...&scenarioId=...`
    - Stores `scenarioSimHouseOverride` which is passed to `UsageDashboard` as `simulatedHousesOverride`.

- **(F) Event counts (unlock gates)**
  - For “Past” and “Future” scenarios:
    - `GET /api/user/simulator/scenarios/:scenarioId/events?houseId=...`
    - Uses `events.length` to compute `pastEventCount` / `futureEventCount`

#### Client component: what triggers recalc (no manual “Recalculate” button)

`UsageSimulatorClient.tsx` serializes recalcs through:

- a **per-scenario debounce map** (`scenarioRecalcTimersRef: Map<string, number>`)
- a **single queue** (`recalcQueueRef`) + a **single runner guard** (`recalcRunningRef`)

Recalc is triggered by:

- auto-baseline generation (once) when:
  - baseline not built yet AND `canRecalc` is true
- weather preference toggle changes
- saving scenario timeline events (Past/Future)
- saving any of: Manual totals, Home profile, Appliances profile (they call `onSaved` → enqueue baseline/past/future recalc)

Actual recalc request:

- `POST /api/user/simulator/recalc`
  - body includes `houseId`, `mode`, `scenarioId` (null for baseline), `weatherPreference`

---

### 3) Server/API call graph (routes → modules → DB)

This section lists endpoints used by the simulator UI (and adjacent entry flows), what they call, and which DB(s) they touch.

#### Auth pattern (user endpoints)

Most user endpoints do:

- Read cookie `intelliwatt_user` via `cookies()` (Next server headers)
- Normalize email: `normalizeEmail(...)`
- Resolve userId from master DB: `prisma.user.findUnique({ where: { email } })`

#### Simulator endpoints

- **`GET /api/user/simulator/requirements`**
  - **Route**: `app/api/user/simulator/requirements/route.ts`
  - **Module**: `getSimulatorRequirements` in `modules/usageSimulator/service.ts` (line ~770)
  - **DB**:
    - master DB (`prisma`): `HouseAddress`, `ManualUsageInput`
    - home-details DB (via repo): `HomeProfileSimulated`
    - appliances DB (via repo): `ApplianceProfileSimulated`
    - actual intervals check: `modules/realUsageAdapter/actual` may hit master DB (`SmtInterval`) and/or usage module DB (`GreenButtonInterval`)

- **`POST /api/user/simulator/recalc`**
  - **Route**: `app/api/user/simulator/recalc/route.ts`
  - **Module**: `recalcSimulatorBuild` in `modules/usageSimulator/service.ts` (line ~100)
  - **DB writes**:
    - master DB: `UsageSimulatorBuild` upsert (see `modules/usageSimulator/repo.ts` via `upsertSimulatorBuild`)
  - **DB reads**:
    - master DB: `ManualUsageInput`, `UsageSimulatorScenario`, `UsageSimulatorScenarioEvent`, `HouseAddress.esiid`
    - home-details DB: `HomeProfileSimulated` (via `modules/homeProfile/repo.ts`)
    - appliances DB: `ApplianceProfileSimulated` (via `modules/applianceProfile/repo.ts`)
    - SMT intervals (master DB: `SmtInterval`) and/or Green Button intervals (usage module DB: `GreenButtonInterval`) depending on `chooseActualSource(...)`

- **`GET/POST /api/user/simulator/scenarios`**
  - **Route**: `app/api/user/simulator/scenarios/route.ts`
  - **Module**: `listScenarios`, `createScenario` in `modules/usageSimulator/service.ts` (line ~607, ~620)
  - **DB**: master DB `UsageSimulatorScenario`

- **`PATCH/DELETE /api/user/simulator/scenarios/:scenarioId`**
  - **Route**: `app/api/user/simulator/scenarios/[scenarioId]/route.ts`
  - **Module**: `renameScenario`, `archiveScenario` in `modules/usageSimulator/service.ts` (line ~640, ~665)
  - **DB**: master DB `UsageSimulatorScenario`

- **`GET/POST /api/user/simulator/scenarios/:scenarioId/events`**
  - **Route**: `app/api/user/simulator/scenarios/[scenarioId]/events/route.ts`
  - **Module**: `listScenarioEvents`, `addScenarioEvent` in `modules/usageSimulator/service.ts` (line ~678, ~694)
  - **DB**: master DB `UsageSimulatorScenarioEvent`
  - **Event shapes**:
    - `kind="MONTHLY_ADJUSTMENT"`: payload `{"multiplier"?: number, "adderKwh"?: number}`
    - `kind="TRAVEL_RANGE"`: payload `{"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}`

- **`PATCH/DELETE /api/user/simulator/scenarios/:scenarioId/events/:eventId`**
  - **Route**: `app/api/user/simulator/scenarios/[scenarioId]/events/[eventId]/route.ts`
  - **Module**: `updateScenarioEvent`, `deleteScenarioEvent` in `modules/usageSimulator/service.ts` (line ~723, ~757)
  - **DB**: master DB `UsageSimulatorScenarioEvent`

#### Usage dataset endpoints (used by simulator + usage dashboard)

- **`GET /api/user/usage`** (actual baseline)
  - **Route**: `app/api/user/usage/route.ts`
  - **DB**:
    - master DB (`prisma`): SMT queries via `$queryRaw` against `SmtInterval`
    - usage module DB (`usagePrisma`): Green Button queries against `GreenButtonInterval` when `USAGE_DATABASE_URL` is configured
  - **Notable behavior**:
    - Green Button totals are **best-effort**; if `USAGE_DATABASE_URL` is missing, the route attempts not to fail the entire endpoint (see `USAGE_DB_ENABLED` guard).

- **`GET /api/user/usage/simulated`** (sim baseline dataset list)
  - **Route**: `app/api/user/usage/simulated/route.ts`
  - **Module**: `getSimulatedUsageForUser` in `modules/usageSimulator/service.ts` (line ~414)
  - **DB**: master DB `UsageSimulatorBuild` + `HouseAddress`

- **`GET /api/user/usage/simulated/builds?houseId=...`**
  - **Route**: `app/api/user/usage/simulated/builds/route.ts`
  - **Module**: `listSimulatedBuildAvailability` in `modules/usageSimulator/service.ts` (line ~527)
  - **DB**: master DB `UsageSimulatorBuild`, `UsageSimulatorScenario`

- **`GET /api/user/usage/simulated/house?houseId=...&scenarioId=...`**
  - **Route**: `app/api/user/usage/simulated/house/route.ts`
  - **Module**: `getSimulatedUsageForHouseScenario` in `modules/usageSimulator/service.ts` (line ~470)
  - **DB**: master DB `UsageSimulatorBuild` (scenarioKey = `BASELINE` or scenario UUID)

- **`POST /api/user/usage/refresh`** (used by Green Button upload flow; also triggers SMT pull)
  - **Route**: `app/api/user/usage/refresh/route.ts`
  - **Behavior**:
    - Requires `ADMIN_TOKEN` env or returns `500 admin_token_missing`
    - Calls admin SMT pull endpoint (`/api/admin/smt/pull`) which triggers the droplet webhook
  - **DB**: master DB (`prisma`): `SmtAuthorization`, `SmtInterval`, `HouseAddress`

---

### 4) Persistence map: what each simulator editor reads/writes

#### Manual totals modal

- **Component**: `components/manual/ManualUsageEntry.tsx`
- **Reads**: `GET /api/user/manual-usage?houseId=...`
- **Writes**: `POST /api/user/manual-usage` with `{ houseId, payload }`
- **Persists to (master DB)**:
  - `ManualUsageInput` (`payload` JSON, `anchorEndMonth`, `anchorEndDate`, `annualEndDate`)
- **Key persisted fields**
  - `payload.anchorEndDate` (YYYY-MM-DD) is authoritative (legacy fields supported for back-compat)
  - `payload.travelRanges` persists (used later by simulator build inputs)

#### Home details modal (includes occupancy)

- **Component**: `components/home/HomeDetailsClient.tsx`
- **Reads**:
  - `GET /api/user/home-profile?houseId=...`
  - `GET /api/user/home-profile/prefill?houseId=...`
- **Writes**:
  - `POST /api/user/home-profile` with `{ houseId, profile, provenance, prefill }`
- **Persists to (home-details module DB)**:
  - `HomeProfileSimulated` (`prisma/home-details/schema.prisma`)
    - `provenanceJson` (optional)
    - `prefillJson` (optional)
- **Occupancy fields persisted**:
  - `occupantsWork`, `occupantsSchool`, `occupantsHomeAllDay` are part of `HomeProfileSimulated`

#### Appliances modal

- **Component**: `components/appliances/AppliancesClient.tsx`
- **Reads**: `GET /api/user/appliances?houseId=...`
- **Writes**: `POST /api/user/appliances` with `{ houseId, profile }`
- **Persists to (appliances module DB)**:
  - `ApplianceProfileSimulated.appliancesJson` (`prisma/appliances/schema.prisma`)

#### Timeline modal (Past/Future)

- **Component**: timeline editor inside `components/usage/UsageSimulatorClient.tsx`
- **Reads**: `GET /api/user/simulator/scenarios/:scenarioId/events?houseId=...`
- **Writes**:
  - Add: `POST /api/user/simulator/scenarios/:scenarioId/events`
  - Edit: `PATCH /api/user/simulator/scenarios/:scenarioId/events/:eventId`
  - Delete: `DELETE /api/user/simulator/scenarios/:scenarioId/events/:eventId?houseId=...`
- **Persists to (master DB)**:
  - `UsageSimulatorScenarioEvent.payloadJson`

---

### 5) WattBuy integration status (prefill + services)

#### What exists today (WattBuy service layer)

- **WattBuy client**: `lib/wattbuy/client.ts`
  - Requires `WATTBUY_API_KEY` (sent as `x-api-key`)
  - Implements fetch with timeout + limited retries
  - Best-effort snapshot persistence (`persistWattBuySnapshot(...)`)

#### What exists today (WattBuy endpoints)

- `POST /api/wattbuy/esiid` → `app/api/wattbuy/esiid/route.ts`
- `POST /api/wattbuy/home` → `app/api/wattbuy/home/route.ts`
- `POST /api/wattbuy/offers` → `app/api/wattbuy/offers/route.ts`
- `GET /api/wattbuy/probe` → `app/api/wattbuy/probe/route.ts` (diagnostics)
- **Dev UI**: `app/wattbuy/debug/page.tsx` exercises the above endpoints.

#### Current simulator “prefill” wiring (home)

- **Prefill endpoint**: `GET /api/user/home-profile/prefill?houseId=...`
  - **Route**: `app/api/user/home-profile/prefill/route.ts`
  - **Data source**: reads **only** `HouseAddress.rawWattbuyJson` from the **master DB**
  - **Important**: it **does not call WattBuy** (`/api/wattbuy/home`) and does not refresh `rawWattbuyJson`.

#### Why prefill is currently “missing” in real flows (wiring gap)

- The primary address save UI (`components/QuickAddressEntry.tsx`) calls:
  - `POST /api/address/save` with `{ googlePlaceDetails, unitNumber, isRenter, keepOtherHouses }`
  - It **does not** include `wattbuyJson`.
- The address save route (`app/api/address/save/route.ts`) sets:
  - `HouseAddress.rawWattbuyJson = body.wattbuyJson`
  - Since the caller doesn’t send it, `rawWattbuyJson` remains **null**, so home prefill returns mostly `UNKNOWN/DEFAULT`.
- The same route **does** call `resolveAddressToEsiid(...)`, which internally calls WattBuy, but it does **not** persist the returned `raw` payload into `rawWattbuyJson`.

#### Appliances “prefill from WattBuy”

- No appliances prefill endpoint or WattBuy-to-appliances mapper was found in the simulator/appliances flow.
- `components/appliances/AppliancesClient.tsx` has **no** WattBuy/prefill code paths.

#### Where prefill would plug in (report-only)

- **Today’s plug point** is already defined as `GET /api/user/home-profile/prefill`.
- To actually prefill from WattBuy reliably, the missing link is populating or refreshing `HouseAddress.rawWattbuyJson` (or changing prefill to call WattBuy directly). This report does not implement either; it only identifies the gap.

---

### 6) DB/schema verification (tables, clients, env vars, migrations)

#### Prisma clients used by simulator wiring

- **Master DB**: `prisma` from `@/lib/db` (schema: `prisma/schema.prisma`)
- **Home Details module DB**: `homeDetailsPrisma` from `lib/db/homeDetailsClient.ts`
  - schema: `prisma/home-details/schema.prisma`
- **Appliances module DB**: `appliancesPrisma` from `lib/db/appliancesClient.ts`
  - schema: `prisma/appliances/schema.prisma`
- **Usage module DB**: `usagePrisma` from `lib/db/usageClient.ts`
  - schema: `prisma/usage/schema.prisma`

#### Env vars required (per schemas + endpoints)

From `docs/ENV_VARS.md` and Prisma datasource blocks:

- **Master DB**: `DATABASE_URL` (and `DIRECT_URL` for migrations/jobs)
- **Home Details DB**: `HOME_DETAILS_DATABASE_URL`
- **Appliances DB**: `APPLIANCES_DATABASE_URL`
- **Usage module DB**: `USAGE_DATABASE_URL`, `USAGE_DIRECT_URL`
- **Green Button uploader**:
  - `GREEN_BUTTON_UPLOAD_URL` (or `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL`)
  - `GREEN_BUTTON_UPLOAD_SECRET`
  - Optional: `GREEN_BUTTON_UPLOAD_MAX_BYTES`
- **SMT refresh trigger**:
  - `ADMIN_TOKEN` is required by `POST /api/user/usage/refresh` to call admin SMT pull
- **WattBuy**:
  - `WATTBUY_API_KEY`

#### Master DB tables touched by simulator wiring (non-exhaustive, but direct)

From `prisma/schema.prisma` + route/service usage:

- `HouseAddress` (includes `esiid`, `rawWattbuyJson`)
- `ManualUsageInput`
- `UsageSimulatorBuild`
- `UsageSimulatorScenario`
- `UsageSimulatorScenarioEvent`
- `SmtInterval`, `RawSmtFile` (actual usage + SMT status/coverage)
- `GreenButtonUpload` (upload status shown on entry hub)
- `SmtAuthorization` (SMT status on entry pages; refresh route)

#### Module DB tables touched

- Home Details DB: `HomeProfileSimulated`
- Appliances DB: `ApplianceProfileSimulated`
- Usage DB: `GreenButtonInterval` (and others; `RawGreenButton`, buckets, etc.)

#### Migration/drift warnings already present in code

`app/api/address/save/route.ts` probes for columns and logs warnings if missing:

- `UserProfile.esiidAttentionRequired`, `esiidAttentionCode`, `esiidAttentionAt` (expects 3 columns)
- `HouseAddress.userEmail`
- `HouseAddress.isRenter`

If these are missing in an environment, the route continues best-effort, but behavior degrades (no persistence of some fields; no “attention” tracking).

---

### 7) Current server errors (observed + code-level failure modes)

This list is ordered by how likely it is to block users entering/saving in the simulator.

#### 7.1 Unauthenticated user redirected away from simulator

- **Repro** (local):
  - Open `GET /dashboard/usage/simulated` without `intelliwatt_user` cookie
- **Observed**
  - `307` redirect to `/login?redirect=/dashboard/usage/simulated`
  - Response payload includes `NEXT_REDIRECT` with stack (see snippet in Step 0 above).
- **Source**
  - `app/dashboard/usage/simulated/page.tsx` uses `redirect(...)` when `!user`
- **Root cause**
  - Expected behavior (auth gate), not a bug.

#### 7.2 Home Details save/read failures when Home Details DB is misconfigured/unreachable

- **Repro** (environment-dependent):
  - Set up a valid session cookie and attempt to load/save Home Details in simulator
  - If `HOME_DETAILS_DATABASE_URL` is missing or DB is unreachable, the endpoint returns `503`
- **Endpoint**
  - `GET/POST /api/user/home-profile`
- **Source**
  - `app/api/user/home-profile/route.ts`
  - Prisma client: `homeDetailsPrisma` (`lib/db/homeDetailsClient.ts`)
- **Response shape**
  - `{ ok: false, error: "home_details_db_missing_env" | "home_details_db_unreachable" | "home_details_db_error_*" }` with HTTP `503`
- **Hypothesis for past “500 Internal server error” reports**
  - In an environment where this newer error mapping is not deployed, or where an exception occurs before the Home Details DB try/catch, the client will see a generic 500.

#### 7.3 Appliances save/read failures when Appliances DB is misconfigured/unreachable

- **Repro** (environment-dependent):
  - Valid session cookie; open/save Appliances modal
  - If `APPLIANCES_DATABASE_URL` is missing or DB is unreachable, endpoint returns `503`
- **Endpoint**
  - `GET/POST /api/user/appliances`
- **Source**
  - `app/api/user/appliances/route.ts`
  - Prisma client: `appliancesPrisma` (`lib/db/appliancesClient.ts`)
- **Response**
  - `{ ok: false, error: "appliances_db_missing_env" | "appliances_db_unreachable" | "appliances_db_error_*" }` with HTTP `503`

#### 7.4 Green Button upload ticket failures

- **Repro**
  - Green Button Upload flow → attempt upload
- **Endpoint**
  - `POST /api/green-button/upload-ticket`
- **Source**
  - `app/api/green-button/upload-ticket/route.ts`
- **Failure modes**
  - `503 green_button_upload_unavailable` if `GREEN_BUTTON_UPLOAD_URL` and `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL` are unset
  - `500 server_not_configured` if `GREEN_BUTTON_UPLOAD_SECRET` is unset

#### 7.5 Usage refresh failures (post-upload and SMT-trigger)

- **Repro**
  - After Green Button upload, the client triggers `POST /api/user/usage/refresh`
- **Endpoint**
  - `POST /api/user/usage/refresh`
- **Source**
  - `app/api/user/usage/refresh/route.ts`
- **Failure modes**
  - `500 admin_token_missing` if `ADMIN_TOKEN` is not configured
  - Downstream admin SMT pull failures (HTTP status + payload surfaced in response)

**Exact error payload for missing `ADMIN_TOKEN`**

```json
{
  "ok": false,
  "error": "admin_token_missing",
  "message": "ADMIN_TOKEN must be configured to trigger SMT pull/normalize."
}
```

#### 7.6 Simulator data endpoints return 401/404 when cookies/user missing

Common across:

- `/api/user/usage`, `/api/user/usage/simulated/*`
- `/api/user/simulator/*`
- `/api/user/manual-usage`
- `/api/user/home-profile`, `/api/user/appliances`

Root cause: `intelliwatt_user` cookie absent or does not match a user in master DB.

---

### 8) Wiring punch-list (gaps only; ordered by “must fix to eliminate server errors”)

1) **Ensure module DB env vars are configured in every environment**
   - **Why**: missing `HOME_DETAILS_DATABASE_URL` / `APPLIANCES_DATABASE_URL` causes hard failures when opening/saving Step 1/2 modals.
   - **Where referenced**: Prisma datasource blocks in:
     - `prisma/home-details/schema.prisma`
     - `prisma/appliances/schema.prisma`

2) **Ensure `USAGE_DATABASE_URL` / `USAGE_DIRECT_URL` are configured where Green Button is expected**
   - **Why**: Green Button interval reads rely on `usagePrisma`; some endpoints degrade best-effort, but simulator requirements and baseline decisions can become inconsistent without GB intervals.
   - **Where referenced**: `prisma/usage/schema.prisma`, `lib/db/usageClient.ts`, `modules/realUsageAdapter/greenButton.ts`

3) **Ensure Green Button uploader env vars exist**
   - **Why**: upload flow is blocked without `GREEN_BUTTON_UPLOAD_URL` (or `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL`) and `GREEN_BUTTON_UPLOAD_SECRET`.
   - **Where referenced**: `app/api/green-button/upload-ticket/route.ts`, `docs/ENV_VARS.md`

4) **Ensure `ADMIN_TOKEN` is set anywhere `/api/user/usage/refresh` is used**
   - **Why**: refresh endpoint returns `500 admin_token_missing` without it.
   - **Where referenced**: `app/api/user/usage/refresh/route.ts`

5) **Fix WattBuy→Home prefill wiring (currently present but not populated)**
   - **Observed gap**:
     - Prefill reads `HouseAddress.rawWattbuyJson`
     - Address save UI does not populate it
   - **Where**:
     - Prefill: `app/api/user/home-profile/prefill/route.ts`
     - Address save UI: `components/QuickAddressEntry.tsx` (does not send `wattbuyJson`)
     - Address save route: `app/api/address/save/route.ts` (stores `body.wattbuyJson` but does not persist WattBuy resolver raw payload)

6) **Resolve potential confusion from duplicate address save routes**
   - **Why**: There is a second route at `src/app/api/address/save/route.ts` that appears to be an older/alternate implementation.
   - **Risk**: depending on project structure, this can create maintenance confusion and accidental edits to a non-active route.

7) **Apply/verify master DB migrations for probed columns**
   - **Why**: missing columns degrade behavior and can break related UX (renter flag persistence, attention flagging).
   - **Where probed**: `app/api/address/save/route.ts`

---

### Appendix A — Key files (starting points)

- Usage Entry hub: `app/dashboard/api/page.tsx`
- Manual entry redirect: `app/dashboard/api/manual/page.tsx`
- Simulator page (server): `app/dashboard/usage/simulated/page.tsx`
- Simulator client: `components/usage/UsageSimulatorClient.tsx`
- Usage dashboard: `components/usage/UsageDashboard.tsx`
- Simulator service: `modules/usageSimulator/service.ts`
- Simulator build inputs: `modules/usageSimulator/build.ts`
- Actual usage adapter: `modules/realUsageAdapter/actual.ts`
- Home profile routes: `app/api/user/home-profile/route.ts`, `app/api/user/home-profile/prefill/route.ts`
- Appliances route: `app/api/user/appliances/route.ts`
- Manual usage route: `app/api/user/manual-usage/route.ts`
- WattBuy endpoints: `app/api/wattbuy/*`

