# EFL Fact Card Engine (Planning Doc)

**Status:** Draft — planning only (no code or schema implemented yet)  
**Owner:** IntelliWatt Core (Plans / Plan Analyzer)  
**Last Updated:** 2025-11-23

---

## Bootstrap for Future Chats

To keep the EFL Fact Card Engine work transferable across chat sessions:

- **Always read this file first** before touching any EFL engine code.
- **After every code or schema update related to this engine**, update the **Implementation Progress** section here so new threads know what changed.
- Keep naming aligned with the codebase (`PlanRules`, `repPuctCertificate`, `eflVersionCode`, `eflPdfSha256`, etc.).
- New chats should treat this document as the authoritative record of which steps are complete and what comes next.

---

## 1. Purpose

The **EFL Fact Card Engine** is the _single_ source of truth for detailed plan rules used by IntelliWatt’s Plan Analyzer and downstream pricing logic.

- It reads **only** the official **Electricity Facts Label (EFL) PDF** published by each REP.
- It extracts structured pricing rules (time-of-use windows, base charges, solar buyback, bill credits, etc.) into a normalized **PlanRules** JSON object.
- It identifies each **plan version** by the REP’s own **Ver. #** string plus the EFL PDF file itself.

This module is **vendor-agnostic**:

- WattBuy, REP portals, or any other upstream feed are used only to:
  - Discover **which plans exist**, and
  - Provide **EFL URLs**.
- They are **never** treated as the pricing source-of-truth. All pricing details come from the EFL.

---

## 2. Scope

### 2.1 In scope

1. **EFL Acquisition (read-only)**  
   - Input:  
     - REP identifier (PUCT certificate number)  
     - EFL PDF URL  
   - Responsibilities:  
     - Download the PDF.  
     - Compute a **SHA-256 hash** of the raw PDF bytes (`eflPdfSha256`).  
     - Store the raw file in our storage layer (path strategy TBD).  
     - Extract raw text using a deterministic PDF-to-text process.

2. **Plan Version Identity (EFL-only)**  
   - Each _specific_ plan version is identified by:  
     - `repPuctCertificate` — REP’s PUCT certificate number (string as printed on EFL).  
     - `eflVersionCode` — exact EFL **Ver. #** string from the document (e.g. `Free Nights 36_ONC_U_1205_995_15_09052025`).  
     - `eflPdfSha256` — SHA-256 hash of the EFL PDF bytes.  
   - These three values form the fingerprint for a specific EFL-backed plan version in our system.

3. **EFL Text Normalization**  
   - One-time per **(repPuctCertificate, eflVersionCode, eflPdfSha256)**:  
     - Convert PDF → text (no AI).  
     - Minimal cleanup only (e.g., headers/footers removal, page numbers).  
     - Preserve all regulatory sections (`Electricity Price`, `Disclosure Chart`, `Other Key Terms`, etc.).

4. **AI Extraction (PlanRules JSON)**  
   - Input to the AI extraction step:  
     - The normalized EFL text only (no WattBuy JSON, no marketing pages).  
   - Output: a **PlanRules** JSON object (CDM for plan pricing rules) containing, at minimum:  
     - Plan type (fixed, TOU, free nights, etc.).  
     - Default energy charges (¢/kWh).  
     - Time-of-use / free-night windows (start/end times, days, months).  
     - Base monthly charges.  
     - TDSP pass-through structure (fixed + per-kWh portions as listed on EFL).  
     - Early termination fee.  
     - Solar buyback rules (if explicitly defined in EFL or its DG rider).  
     - Bill credits / minimum usage terms.  
   - The AI result is cached so **we only pay once per unique EFL version**.

5. **Persistence Hooks (Planning Only)**  
   - This doc defines the field names and shapes that future Prisma models will use, but does not create them yet.
   - Future schema will attach `PlanRules` and EFL identity to our existing plan CDM (`RatePlan`) without renaming or duplicating existing fields.

### 2.2 Out of scope (for this doc)

- No changes to `RatePlan` or any existing Prisma models.  
- No changes to WattBuy client code or normalization yet.  
- No Plan Analyzer logic changes (it will later be updated to read `PlanRules`).  
- No UI changes (plan cards, admin screens) yet.

---

## 3. Identity Model (Plan Versions)

The EFL Fact Card Engine treats each **plan version** as a combination of REP + EFL metadata.

### 3.1 Core identifiers

Planned identity fields (to be implemented in schema later):

- `repPuctCertificate` (string)  
  - PUCT Certificate number as printed on the EFL.  
  - Example: `"10260"`.

- `eflVersionCode` (string)  
  - Exact value from the **“Ver. #:”** line in the EFL.  
  - Example:  
    - Printed on EFL:  
      - `Ver. #: Free Nights 36_ONC_U_1205_995_15_09052025`  
    - Stored as:  
      - `eflVersionCode = "Free Nights 36_ONC_U_1205_995_15_09052025"`.

- `eflPdfSha256` (string)  
  - SHA-256 hash of the PDF bytes.  
  - Used to detect whether the underlying document content changed, even if URLs or wrapping change.

### 3.2 Version behavior

- If we ingest a new EFL for the _same_ REP + `eflVersionCode` + identical `eflPdfSha256`:
  - We do **not** re-run AI; existing `PlanRules` are reused.
- If the EFL content changes (different `eflPdfSha256`), or the `Ver. #` changes:
  - We treat it as a **new plan version** and run extraction again.
- Legacy / historical analyses can continue to reference older plan versions.

---

## 4. Data Flow (High Level)

This module sits between **plan sources** (WattBuy, REP feeds) and **IntelliWatt’s internal Plan Analyzer / pricing engine**.

1. **Plan source identifies plan + EFL URL**  
   - Example: WattBuy retail-rates or a REP portal feed.  
   - We use:
     - Supplier / REP info from the source.  
     - EFL URL from the source.  
   - We **do not** trust this source for pricing math; it only helps us find the EFL.

2. **EFL Fact Card Engine ingestion**  
   - Download EFL PDF.  
   - Compute `eflPdfSha256`.  
   - Extract `repPuctCertificate` and `eflVersionCode` from the EFL text.  
   - Persist the raw PDF and normalized EFL text (storage mechanism TBD).

3. **PlanRules extraction**  
   - Run AI extraction once per unique `(repPuctCertificate, eflVersionCode, eflPdfSha256)`.  
   - AI returns `PlanRules` JSON (see Section 5).  
   - Store `PlanRules` and a parse metadata block:  
     - `parseConfidence` (0–1)  
     - `parseWarnings` (array of strings / JSON)  
     - `source = "efl_pdf"`.

4. **Integration with RatePlan (future)**  
   - A future step will link `RatePlan` to the EFL Fact Card Engine outputs:  
     - Each `RatePlan` row will map to one or more EFL-backed plan versions, using:  
       - REP identity and product name  
       - EFL-specific fields (`eflVersionCode`, `eflPdfSha256`).  
   - Plan Analyzer will use `RatePlan` + linked `PlanRules` to compute detailed 15-minute pricing for:
     - Time-of-use plans  
     - Free nights/weekends  
     - Solar buyback  
     - Special bill credit structures.

---

## 5. PlanRules (Extraction Contract)

This section defines the **logical** shape of `PlanRules`. Actual TypeScript types and Prisma fields will be created in a later step, but naming here is authoritative for that future work.

### 5.1 Core PlanRules fields (planned names)

- `planType` (string)  
  - Allowed values will include: `"flat"`, `"tou"`, `"free-nights"`, `"free-weekends"`, `"solar-buyback"`, `"other"`.  
- `defaultRateCentsPerKwh` (number | null)  
  - Energy charge in cents/kWh when no specific TOU band applies.  
- `baseChargePerMonthCents` (number | null)  
  - Recurring base charge from the EFL (REP portion only).  
- `timeOfUsePeriods` (array)  
  - Each entry describes a labeled window (e.g., `Free Nights`) with:  
    - `label` (string)  
    - `startHour` (number, 0–23, local)  
    - `endHour` (number, 0–23, local, can cross midnight)  
    - `daysOfWeek` (array of 0–6, Sunday–Saturday)  
    - `months` (optional array of 1–12)  
    - `rateCentsPerKwh` (number | null)  
    - `isFree` (boolean)  
- `solarBuyback` (object | null)  
  - Fields (if EFL / DG rider defines DG rules):  
    - `hasBuyback` (boolean)  
    - `creditCentsPerKwh` (number | null)  
    - `matchesImportRate` (boolean | null)  
    - `maxMonthlyExportKwh` (number | null)  
    - `notes` (string | null).  
- `billCredits` (array)  
  - Captures bill credit/minimum usage structures that the EFL explicitly states.  
  - Each rule will include:  
    - `thresholdKwh` (number)  
    - `creditDollars` (number).  

These field names are intended to be used directly in:

- TypeScript CDM types for plan rules.  
- JSON columns / tables that store extracted rules.  
- Plan Analyzer and pricing engine logic.

---

## 6. AI Usage Rules

To control cost and ensure correctness:

1. **Source restriction**  
   - AI sees only the EFL text (and, if needed in the future, DG rider / TOS snippets related to solar).  
   - It never sees WattBuy marketing text as a “truth” source.

2. **Frequency**  
   - One AI extraction per unique **EFL version**, defined by `(repPuctCertificate, eflVersionCode, eflPdfSha256)`.  
   - Subsequent lookups of the same version reuse the stored `PlanRules`.

3. **Deterministic fallback**  
   - For simple fields (e.g., obvious energy charges, base charges, straightforward free-night windows), we may later implement regex-based extraction.  
   - AI is reserved for complex structures (bill credits, solar caps, nuanced wording).

4. **Confidence and reviews**  
   - AI responses store `parseConfidence` and `parseWarnings`.  
   - Admin tools (future) can use these to flag low-confidence parses for manual review.

---

## 7. Relationship to Existing Models

This module must integrate with existing naming and models rather than replace them.

- **RatePlan**  
  - Remains the **canonical plan CDM** for UI and Plan Analyzer input.  
  - Will be extended (or linked) to include a reference to the EFL-backed plan version and its `PlanRules`.  
  - We do **not** rename `RatePlan` or duplicate its existing fields.

- **RawWattbuyRetailRate / RawWattbuyElectricity / RawWattbuyElectricityInfo**  
  - Continue to store RAW vendor payloads per current plan.  
  - Their role is to:
    - provide plan lists,  
    - provide TDSP / utility context,  
    - give us **EFL URLs**.  
  - They do not override EFL-derived pricing.

- **Plan Analyzer**  
  - Already defined in `PROJECT_PLAN.md` as consuming CDM only.  
  - In future steps, Plan Analyzer will read `RatePlan` + attached `PlanRules` from this module for accurate TOU / solar / bill-credit calculations.

---

## 8. Future Work (Not Part of This Step)

The following items depend on this planning doc and will be implemented in later Cursor steps:

1. **Prisma Schema Additions**  
   - Add models/tables and fields matching the names defined here:  
     - `repPuctCertificate`  
     - `eflVersionCode`  
     - `eflPdfSha256`  
     - `PlanRules` storage (likely JSON)  
     - `parseConfidence`, `parseWarnings`.  

2. **EFL Fetch + Text Extractor**  
   - Library function to download PDFs, compute SHA-256, and normalize text.  

3. **AI Extraction Implementation** ✅  
   - Completed via `lib/efl/aiExtraction.ts` (see Implementation Progress).  

4. **RatePlan Integration**  
   - Link `RatePlan` entries to EFL-backed plan versions.  
   - Ensure plan cards and Plan Analyzer pull from EFL-only rule sets.

5. **Admin / Debug UIs**  
   - Admin view to inspect EFLs, PlanRules, parse confidence/warnings.  

Until those steps are executed, this document is the **authoritative naming and design reference** for the EFL Fact Card Engine but is not yet live in the runtime.

---

## Implementation Progress

- [x] **Step 1 – Core PlanRules CDM and interval pricing helpers**
  - Implemented `PlanRules`, `TimeOfUsePeriod`, `SolarBuybackConfig`, and `BillCreditRule` types in `lib/efl/planEngine.ts`.
  - Added `getActivePeriodForTimestamp`, `getIntervalPricingForTimestamp`, and `computeIntervalCharge` to compute per-interval pricing and charges.
  - This module is pure logic and does not depend on WattBuy, Prisma, or HTTP.
- [x] **Step 2 – Deterministic EFL ingestion (PDF → text)**
  - Implemented `lib/efl/eflExtractor.ts` with:
    - `computePdfSha256` to fingerprint PDFs.
    - A pluggable `PdfTextExtractor` interface for deterministic PDF→text conversion.
    - `deterministicEflExtract` to produce cleaned `rawText`, extract `repPuctCertificate` and `eflVersionCode`, and emit warnings when either is missing.
  - No AI or database wiring yet; this layer remains standalone and source-agnostic.
- [x] **Step 3 – AI Extraction Layer (EFL text → PlanRules)**
  - Implemented pure helper module `lib/efl/aiExtraction.ts`.
  - Added `buildPlanRulesExtractionPrompt` to generate the strict extraction prompt.
  - Added `extractPlanRulesFromEflText`, which accepts deterministic extract output, calls an injected `PlanRulesModelCaller`, and normalizes the result into `planRules`, `parseConfidence`, `parseWarnings`, with `source = "efl_pdf"`.
  - Remains vendor-agnostic; higher layers supply the actual LLM integration.

---

## Next Steps (Planned)

- **Step 4 – RatePlan Integration**
  - Link `RatePlan` entries to EFL-backed plan versions.
  - Ensure plan cards and Plan Analyzer pull from EFL-only rule sets.
- **Step 5 – Admin / Debug UIs**
  - Admin view to inspect EFLs, PlanRules, parse confidence/warnings.

