import type { PlanRules, RateStructure } from "@/lib/efl/planEngine";
import type { EflAvgPriceValidation } from "@/lib/efl/eflValidator";
import { extractEflTdspCharges, validateEflAvgPriceTable } from "@/lib/efl/eflValidator";

export type EflValidationGapSolveMode = "NONE" | "PASS_WITH_ASSUMPTIONS" | "FAIL";

export interface EflValidationGapSolveResult {
  derivedPlanRules: PlanRules | any | null;
  derivedRateStructure: RateStructure | any | null;
  solverApplied: string[];
  assumptionsUsed: EflAvgPriceValidation["assumptionsUsed"] | Record<string, any>;
  validationAfter: EflAvgPriceValidation | null;
  solveMode: EflValidationGapSolveMode;
  queueReason?: string;
}

export async function solveEflValidationGaps(args: {
  rawText: string;
  planRules: PlanRules | any | null;
  rateStructure: RateStructure | any | null;
  validation: EflAvgPriceValidation | null;
}): Promise<EflValidationGapSolveResult> {
  const { rawText, planRules, rateStructure, validation } = args;

  // Clone planRules shallowly so we can add derived fields without mutating callers.
  //
  // IMPORTANT: Some parses can return null/empty planRules even when rawText contains enough
  // deterministic structure (e.g. TOU peak/off-peak blocks). We still want the solver to be able
  // to construct a minimal PlanRules envelope so templates can be computed consistently.
  const derivedPlanRules: any =
    planRules && typeof planRules === "object" ? { ...(planRules as any) } : {};
  let derivedRateStructure: any = rateStructure ?? null;

  const solverApplied: string[] = [];

  // ---------------- Tier sync from RateStructure -> PlanRules ----------------
  if (derivedPlanRules && derivedRateStructure) {
    const existingTiers: any[] = Array.isArray(derivedPlanRules.usageTiers)
      ? derivedPlanRules.usageTiers
      : [];

    // Support both RateStructure.usageTiers (CDM) and the older "array of tier
    // rows" shape used by some admin tools.
    const rsUsageTiers: any[] = Array.isArray(
      (derivedRateStructure as any).usageTiers,
    )
      ? (derivedRateStructure as any).usageTiers
      : Array.isArray(derivedRateStructure)
        ? (derivedRateStructure as any[])
        : [];

    if (rsUsageTiers.length > 0) {
      const shouldSync =
        !Array.isArray(derivedPlanRules.usageTiers) ||
        existingTiers.length === 0 ||
        existingTiers.length < rsUsageTiers.length;

      if (shouldSync) {
        const mapped = rsUsageTiers
          .map((t) => {
            const minRaw =
              t?.minKWh ?? t?.minKwh ?? t?.tierMinKwh ?? t?.tierMinKWh ?? 0;
            const maxRaw =
              t?.maxKWh ?? t?.maxKwh ?? t?.tierMaxKwh ?? t?.tierMaxKWh;

            const min = Number(minRaw);
            const max =
              maxRaw == null || !Number.isFinite(Number(maxRaw))
                ? null
                : Number(maxRaw);

            let rate = t?.centsPerKWh ?? t?.rateCentsPerKwh;
            if (
              rate == null &&
              typeof t?.energyCharge === "number" &&
              Number.isFinite(t.energyCharge)
            ) {
              // Older tier rows sometimes use `energyCharge` but the unit is ambiguous across callers:
              // - Some sources store dollars/kWh (e.g. 0.2299) → needs *100 to get cents/kWh
              // - Others store cents/kWh (e.g. 22.99) → should be used as-is
              //
              // Heuristic: if value is <= 2, treat as dollars/kWh; otherwise treat as cents/kWh.
              rate = t.energyCharge <= 2 ? t.energyCharge * 100 : t.energyCharge;
            }
            const rateNum = Number(rate);
            if (!Number.isFinite(rateNum)) return null;

            return {
              minKwh: Number.isFinite(min) ? min : 0,
              maxKwh: max,
              rateCentsPerKwh: rateNum,
            };
          })
          .filter(Boolean)
          // Ensure tiers are ordered by minKwh so downstream math behaves.
          .sort((a: any, b: any) => a.minKwh - b.minKwh);

        if (mapped.length > 0) {
          derivedPlanRules.usageTiers = mapped;

          // If this is effectively a flat plan encoded as a single open-ended tier,
          // also populate defaultRateCentsPerKwh so PlanRules validation passes and
          // downstream engines can treat it as a standard FIXED plan.
          const t0: any = mapped.length === 1 ? mapped[0] : null;
          if (
            t0 &&
            Number(t0?.minKwh) === 0 &&
            (t0?.maxKwh == null || t0?.maxKwh === null) &&
            (typeof (derivedPlanRules as any).defaultRateCentsPerKwh !== "number" ||
              !Number.isFinite((derivedPlanRules as any).defaultRateCentsPerKwh))
          ) {
            (derivedPlanRules as any).defaultRateCentsPerKwh = t0.rateCentsPerKwh;
            if (!String((derivedPlanRules as any).rateType ?? "").trim()) {
              (derivedPlanRules as any).rateType = "FIXED";
            }
            if (!String((derivedPlanRules as any).planType ?? "").trim()) {
              (derivedPlanRules as any).planType = "flat";
            }
            solverApplied.push("FLAT_TIER_TO_DEFAULT_RATE");
          }

          // Normalize legacy "array-of-tier-rows" RateStructure into the canonical RateStructure shape
          // so downstream validator/plan-engine can run deterministically.
          if (Array.isArray(derivedRateStructure)) {
            const rsTiers = mapped.map((x: any) => ({
              minKWh: x.minKwh,
              maxKWh: x.maxKwh ?? null,
              centsPerKWh: x.rateCentsPerKwh,
            }));
            const baseMonthlyFeeCents =
              typeof (derivedPlanRules as any).baseChargePerMonthCents === "number"
                ? (derivedPlanRules as any).baseChargePerMonthCents
                : undefined;
            const energyRateCents =
              t0 && Number(t0?.minKwh) === 0 && t0?.maxKwh == null
                ? t0.rateCentsPerKwh
                : undefined;
            derivedRateStructure = {
              type: "FIXED",
              baseMonthlyFeeCents,
              ...(typeof energyRateCents === "number" ? { energyRateCents } : {}),
              usageTiers: rsTiers,
            };
          }

          solverApplied.push("TIER_SYNC_FROM_RATE_STRUCTURE");
        }
      }
    }
  }

  // ---------------- Tier sync from EFL raw text (deterministic) ----------------
  // If usageTiers are still missing or clearly incomplete (e.g. only first tier
  // present when the EFL lists multiple tiers), re-derive from the raw text.
  if (derivedPlanRules) {
    const existingTiers: any[] = Array.isArray(derivedPlanRules.usageTiers)
      ? derivedPlanRules.usageTiers
      : [];

    const tiersFromText = extractUsageTiersFromEflText(rawText);

    const shouldApplyFromText =
      tiersFromText.length > 0 &&
      (existingTiers.length === 0 || existingTiers.length < tiersFromText.length);

    if (shouldApplyFromText) {
      derivedPlanRules.usageTiers = tiersFromText;
      solverApplied.push("SYNC_USAGE_TIERS_FROM_EFL_TEXT");
    }
  }

  // ---------------- TDSP gap heuristic (for observability only) ----------------
  const maskedTdsp =
    detectMaskedTdsp(rawText) &&
    (!!validation &&
      (validation.assumptionsUsed?.tdspAppliedMode === "NONE" ||
        validation.assumptionsUsed?.tdspAppliedMode === undefined));
  if (maskedTdsp) {
    solverApplied.push("TDSP_UTILITY_TABLE_CANDIDATE");
  }

  // ---------------- Base charge sync from EFL text ----------------
  if (derivedPlanRules && derivedPlanRules.baseChargePerMonthCents == null) {
    const baseCents = extractBaseChargeCentsFromEflText(rawText);
    if (baseCents != null) {
      derivedPlanRules.baseChargePerMonthCents = baseCents;

      if (!derivedRateStructure) {
        // Minimal shape; callers treat this as partial RateStructure.
        derivedRateStructure = {};
      }

      if (
        derivedRateStructure &&
        typeof (derivedRateStructure as any).baseMonthlyFeeCents !== "number"
      ) {
        (derivedRateStructure as any).baseMonthlyFeeCents = baseCents;
      }

      solverApplied.push("SYNC_BASE_CHARGE_FROM_EFL_TEXT");
    }
  }

  // ---------------- Single fixed "Energy Charge" fallback ----------------
  // Some EFLs clearly disclose a single REP energy charge like:
  //   "Energy Charge 22.99¢ per kWh"
  // but our AI parse can still fail-closed and omit defaultRateCentsPerKwh, causing
  // UNSUPPORTED_RATE_STRUCTURE even though the plan is computable (with TDSP added separately).
  if (derivedPlanRules) {
    const hasTou =
      Array.isArray((derivedPlanRules as any).timeOfUsePeriods) &&
      (derivedPlanRules as any).timeOfUsePeriods.length > 0;
    const hasTiers =
      Array.isArray((derivedPlanRules as any).usageTiers) &&
      (derivedPlanRules as any).usageTiers.length > 0;

    const needsDefault =
      typeof (derivedPlanRules as any).defaultRateCentsPerKwh !== "number" ||
      !Number.isFinite((derivedPlanRules as any).defaultRateCentsPerKwh);

    if (!hasTou && !hasTiers && needsDefault) {
      // Prefer extracting from (sometimes non-canonical) AI rateStructure objects first.
      const cents =
        extractSingleEnergyChargeCentsPerKwhFromRateStructure(derivedRateStructure) ??
        extractSingleEnergyChargeCentsPerKwhFromEflText(rawText);
      if (typeof cents === "number" && Number.isFinite(cents) && cents >= 0) {
        (derivedPlanRules as any).defaultRateCentsPerKwh = cents;
        // Best-effort normalization: mark as FIXED/flat when we infer a single rate.
        if (!String((derivedPlanRules as any).rateType ?? "").trim()) {
          (derivedPlanRules as any).rateType = "FIXED";
        }
        if (!String((derivedPlanRules as any).planType ?? "").trim()) {
          (derivedPlanRules as any).planType = "flat";
        }

        if (!derivedRateStructure || typeof derivedRateStructure !== "object") {
          derivedRateStructure = {};
        }
        if (String((derivedRateStructure as any).type ?? "") !== "FIXED") {
          (derivedRateStructure as any).type = "FIXED";
        }
        // IMPORTANT:
        // Override suspicious "energyRateCents" values when we can confidently extract an Energy Charge from EFL text.
        // A common failure mode in side-by-side "Electricity Price" tables is to accidentally store the TDSP
        // delivery ¢/kWh as the REP energy rate (making customer-facing estimates far too low).
        try {
          const existingRaw = (derivedRateStructure as any).energyRateCents;
          const existing =
            typeof existingRaw === "number" && Number.isFinite(existingRaw) ? (existingRaw as number) : null;
          const currentBillRaw = (derivedPlanRules as any).currentBillEnergyRateCents;
          const currentBill =
            typeof currentBillRaw === "number" && Number.isFinite(currentBillRaw) ? (currentBillRaw as number) : null;
          const tdspPer = (() => {
            try {
              const td = extractEflTdspCharges(rawText);
              return typeof td?.perKwhCents === "number" && Number.isFinite(td.perKwhCents) ? td.perKwhCents : null;
            } catch {
              return null;
            }
          })();
          const near = (a: number, b: number) => Math.abs(a - b) <= 0.02;

          const shouldOverride =
            existing != null &&
            (
              // Existing looks like TDSP per-kWh (most common bad case)
              (tdspPer != null && near(existing, tdspPer) && !near(cents, tdspPer) && Math.abs(cents - existing) >= 0.25) ||
              // Existing disagrees with current bill rate, but extracted cents matches it
              (currentBill != null && near(cents, currentBill) && !near(existing, cents) && Math.abs(cents - existing) >= 0.25)
            );

          if (existing == null || shouldOverride) {
            (derivedRateStructure as any).energyRateCents = cents;
          }
        } catch {
          if (typeof (derivedRateStructure as any).energyRateCents !== "number") {
            (derivedRateStructure as any).energyRateCents = cents;
          }
        }

        solverApplied.push("FALLBACK_FIXED_ENERGY_CHARGE_FROM_EFL_TEXT");
      }
    }
  }

  // ---------------- Seasonal % discount off Energy Charge (month-scoped TOU) ----------------
  // Some EFLs disclose a flat energy charge plus a seasonal discount period, e.g.:
  //   "50 percent discount off the Energy Charge ... from June 1 ... through September 30 ..."
  //
  // The EFL's avg-price table often reflects an annualized average across the contract year,
  // so for deterministic validation we model this as 2 all-day TOU periods split by months.
  //
  // This keeps the plan computable with only kwh.m.all.total buckets (all-day windows).
  if (derivedPlanRules) {
    const hasTou =
      Array.isArray((derivedPlanRules as any).timeOfUsePeriods) &&
      (derivedPlanRules as any).timeOfUsePeriods.length > 0;
    const hasTiers =
      Array.isArray((derivedPlanRules as any).usageTiers) &&
      (derivedPlanRules as any).usageTiers.length > 0;

    if (!hasTou && !hasTiers) {
      const baseRate =
        typeof (derivedPlanRules as any).defaultRateCentsPerKwh === "number" &&
        Number.isFinite((derivedPlanRules as any).defaultRateCentsPerKwh)
          ? Number((derivedPlanRules as any).defaultRateCentsPerKwh)
          : null;

      const seasonal = extractSeasonalEnergyDiscount(rawText);
      if (seasonal && baseRate != null && baseRate > 0) {
        const discMonths = seasonal.months;
        const otherMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !discMonths.includes(m));
        const discountedRate = baseRate * (1 - seasonal.discountPct);

        if (Number.isFinite(discountedRate) && discountedRate >= 0) {
          (derivedPlanRules as any).rateType = "TIME_OF_USE";
          (derivedPlanRules as any).planType = (derivedPlanRules as any).planType ?? "tou";
          (derivedPlanRules as any).timeOfUsePeriods = [
            {
              label: `Seasonal energy discount (${Math.round(seasonal.discountPct * 100)}% off)`,
              startHour: 0,
              endHour: 24,
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              months: otherMonths,
              rateCentsPerKwh: baseRate,
              isFree: false,
            },
            {
              label: `Seasonal energy discount (${Math.round(seasonal.discountPct * 100)}% off)`,
              startHour: 0,
              endHour: 24,
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              months: discMonths,
              rateCentsPerKwh: discountedRate,
              isFree: false,
            },
          ];
          solverApplied.push("SEASONAL_ENERGY_DISCOUNT_TO_MONTHLY_TOU");
        }
      }
    }
  }

  // ---------------- Conditional service fee cutoff (<= N kWh) ----------------
  // Some EFLs describe a monthly/service fee that only applies up to a maximum usage,
  // e.g., "Monthly Service Fee $8.00 per billing cycle for usage (<=1999) kWh".
  //
  // The canonical RateStructure contract does not currently support conditional base fees.
  // For validation math (and downstream persistence), we model this as:
  //   baseMonthlyFeeCents = feeCents
  //   AND a "bill credit" of feeCents that applies when usage >= (maxKwh + 1)
  //
  // This makes the fee apply for 500/1000 but net to $0 at 2000+ (matching the EFL table),
  // without introducing supplier-specific patches.
  if (validation?.status === "FAIL" && derivedPlanRules) {
    const fee = extractMonthlyServiceFeeCutoff(rawText);
    if (fee && fee.feeCents > 0 && fee.maxUsageKwh >= 1) {
      const alreadyHasBase =
        typeof derivedPlanRules.baseChargePerMonthCents === "number" ||
        (derivedRateStructure &&
          typeof (derivedRateStructure as any).baseMonthlyFeeCents === "number");

      const thresholdKwh = fee.maxUsageKwh + 1;
      const inferredOk = baseFeeInferredFromValidation({
        validation,
        feeCents: fee.feeCents,
        maxUsageKwh: fee.maxUsageKwh,
      });

      if (!alreadyHasBase && inferredOk) {
        // Apply base fee
        derivedPlanRules.baseChargePerMonthCents = fee.feeCents;
        if (!derivedRateStructure) derivedRateStructure = {};
        if (typeof (derivedRateStructure as any).baseMonthlyFeeCents !== "number") {
          (derivedRateStructure as any).baseMonthlyFeeCents = fee.feeCents;
        }

        // Apply offsetting credit at >= threshold
        const rsCredits = (derivedRateStructure as any).billCredits;
        const rules: any[] =
          rsCredits && Array.isArray(rsCredits.rules) ? rsCredits.rules : [];
        const hasSame =
          rules.some(
            (r) =>
              Number(r?.creditAmountCents) === fee.feeCents &&
              Number(r?.minUsageKWh) === thresholdKwh,
          ) ?? false;
        if (!hasSame) {
          const nextRules = [
            ...rules,
            {
              label: `Service fee waived at >= ${thresholdKwh} kWh (derived from <=${fee.maxUsageKwh} fee)`,
              creditAmountCents: fee.feeCents,
              minUsageKWh: thresholdKwh,
            },
          ];
          (derivedRateStructure as any).billCredits = {
            hasBillCredit: true,
            rules: nextRules,
          };
        }

        // Mirror to PlanRules billCredits for consistency/debugging.
        const prCredits: any[] = Array.isArray(derivedPlanRules.billCredits)
          ? derivedPlanRules.billCredits
          : [];
        const hasPrSame =
          prCredits.some(
            (r) =>
              Number(r?.creditDollars) === fee.feeCents / 100 &&
              Number(r?.thresholdKwh) === thresholdKwh,
          ) ?? false;
        if (!hasPrSame) {
          derivedPlanRules.billCredits = [
            ...prCredits,
            {
              label: `Service fee waived at >= ${thresholdKwh} kWh (derived)`,
              creditDollars: fee.feeCents / 100,
              thresholdKwh: thresholdKwh,
              monthsOfYear: null,
              type: "THRESHOLD_MIN",
            },
          ];
        }

        solverApplied.push("SERVICE_FEE_CUTOFF_MAXKWH_TO_BASE_PLUS_CREDIT");
      }
    }
  }

  // ---------------- Prepaid: Daily Charge + max-usage Monthly Credit ----------------
  // Example (Payless prepaid):
  //   "Daily Charge $0.85 per day."
  //   "Monthly Credit -$15.00 Applies: 500 kWh usage or less"
  //
  // Generalized modeling for avg-table validation:
  // - Convert daily charge into an equivalent monthly base fee assuming a 30-day month
  //   (EFLs commonly state "prorated if under 30 days" and the disclosure table assumes 30 days).
  // - Convert "usage or less" monthly credits into a negative bill credit that applies
  //   when usage < (maxKwh+1). The validator already supports this semantics for negative credits.
  if (validation?.status === "FAIL" && derivedPlanRules) {
    const daily = extractDailyCharge(rawText);
    const credit = extractMonthlyCreditMaxUsage(rawText);

    // Only apply when we are missing base fee / credits in the derived shapes.
    const hasBase =
      typeof derivedPlanRules.baseChargePerMonthCents === "number" ||
      (derivedRateStructure && typeof (derivedRateStructure as any).baseMonthlyFeeCents === "number");
    const existingCredits: any[] = Array.isArray(derivedPlanRules.billCredits)
      ? derivedPlanRules.billCredits
      : [];
    const hasAnyCredits = existingCredits.length > 0;

    if (daily && daily.dailyDollars > 0 && !hasBase) {
      const baseCents = Math.round(daily.dailyDollars * 30 * 100);
      derivedPlanRules.baseChargePerMonthCents = baseCents;
      if (!derivedRateStructure) derivedRateStructure = {};
      if (typeof (derivedRateStructure as any).baseMonthlyFeeCents !== "number") {
        (derivedRateStructure as any).baseMonthlyFeeCents = baseCents;
      }
      solverApplied.push("DAILY_CHARGE_PER_DAY_TO_MONTHLY_BASE_FEE");
    }

    if (credit && credit.creditDollars > 0 && credit.maxUsageKwh >= 1 && !hasAnyCredits) {
      // Represent as a "usage <= threshold" credit (supported by the validator).
      const thresholdKwh = credit.maxUsageKwh;
      derivedPlanRules.billCredits = [
        {
          label: `Monthly credit $${credit.creditDollars.toFixed(2)} applies <= ${credit.maxUsageKwh} kWh`,
          creditDollars: credit.creditDollars,
          thresholdKwh,
          monthsOfYear: null,
          type: "THRESHOLD_MAX",
        },
      ];
      solverApplied.push("MONTHLY_CREDIT_MAX_USAGE_TO_THRESHOLD_MAX_CREDIT");
    }
  }

  // ---------------- Usage bill credits (threshold-min; additive-safe) ----------------
  // Example EFL (Constellation):
  //   Residential Usage Credit 35.00 $ per bill month if usage >= 1000kWh
  //   Additional Residential Usage Credit 15.00 $ per bill month if usage >= 2000kWh
  //
  // These are additive credits. Our deterministic bill credit extractor fails-closed on overlapping
  // usage ranges, so we normalize these into non-overlapping segments:
  //   [1000,2000) => $35
  //   [2000,∞)    => $50
  if (validation?.status === "FAIL" && derivedPlanRules) {
    const existingRsRules: any[] =
      derivedRateStructure?.billCredits && Array.isArray((derivedRateStructure as any).billCredits?.rules)
        ? ((derivedRateStructure as any).billCredits.rules as any[])
        : [];
    const hasAnyRsCredits = existingRsRules.length > 0;

    const existingPrCredits: any[] = Array.isArray((derivedPlanRules as any).billCredits)
      ? ((derivedPlanRules as any).billCredits as any[])
      : [];
    const hasAnyPrCredits = existingPrCredits.length > 0;

    if (!hasAnyRsCredits && !hasAnyPrCredits) {
      const extracted = extractThresholdMinUsageCreditsFromEflText(rawText);
      const segments = normalizeAdditiveThresholdCreditsToSegments(extracted);
      if (segments.length > 0) {
        if (!derivedRateStructure || typeof derivedRateStructure !== "object") {
          derivedRateStructure = {};
        }
        (derivedRateStructure as any).billCredits = {
          hasBillCredit: true,
          rules: segments.map((s) => ({
            label: s.label,
            creditAmountCents: s.creditCents,
            minUsageKWh: s.minUsageKWh,
            ...(typeof s.maxUsageKWh === "number" ? { maxUsageKWh: s.maxUsageKWh } : {}),
          })),
        };

        // Validator math uses PlanRules.billCredits with additive THRESHOLD_MIN semantics.
        // Keep the original extracted events here (35@1000 + 15@2000), rather than the
        // non-overlapping segments (35@1000, 50@2000) which would double-count at 2000+.
        (derivedPlanRules as any).billCredits = extracted.map((c) => ({
          label: c.label,
          creditDollars: c.creditCents / 100,
          thresholdKwh: c.minUsageKWh,
          monthsOfYear: null,
          type: "THRESHOLD_MIN",
        }));

        solverApplied.push("SYNC_USAGE_BILL_CREDITS_THRESHOLD_MIN_FROM_EFL_TEXT");
      }
    }
  }

  // ---------------- TOU: Peak / Off-Peak rates + disclosed Off-Peak usage % ----------------
  // Example (OhmConnect EVConnect):
  //   Energy Charge Peak 11.84¢ / kWh
  //   Energy Charge Off-Peak 5.92¢ / kWh
  //   "Average price is based on usage profile ... of 32% of Off-Peak consumption..."
  //   Off-Peak hours are 9:00 PM - 4:59 AM. Peak hours are 5:00 AM - 8:59 PM
  //
  // When we only capture a single "Energy Charge" rate, modeled prices end up too low.
  //
  // IMPORTANT: we apply this even when the avg-price table already PASSes, because
  // the validator may have extracted TOU assumptions (nightUsagePercent / hours)
  // directly from the EFL text. If we don't upgrade the template to TIME_OF_USE,
  // we can end up with a plan that "validates" but is not safely computable.
  if (derivedPlanRules) {
    const hasTou =
      Array.isArray((derivedPlanRules as any).timeOfUsePeriods) &&
      (derivedPlanRules as any).timeOfUsePeriods.length > 0;

    if (hasTou) {
      // If we already have TOU periods in PlanRules, we must ensure the RateStructure is also upgraded.
      // This prevents "PASS" validations from slipping through as non-TOU templates (unsafe to compute).
      const periods = Array.isArray((derivedPlanRules as any).timeOfUsePeriods)
        ? ((derivedPlanRules as any).timeOfUsePeriods as any[])
        : [];

      let changed = false;

      // Normalize PlanRules fields for consistency.
      if (String((derivedPlanRules as any).rateType ?? "") !== "TIME_OF_USE") {
        (derivedPlanRules as any).rateType = "TIME_OF_USE";
        changed = true;
      }
      if (String((derivedPlanRules as any).planType ?? "") !== "tou") {
        (derivedPlanRules as any).planType = "tou";
        changed = true;
      }

      // Ensure a sane fallback default rate exists.
      const fallbackRate = periods.find((p) => typeof p?.rateCentsPerKwh === "number")?.rateCentsPerKwh;
      if (typeof (derivedPlanRules as any).defaultRateCentsPerKwh !== "number" && typeof fallbackRate === "number") {
        (derivedPlanRules as any).defaultRateCentsPerKwh = fallbackRate;
        changed = true;
      }

      // Ensure RateStructure is upgraded so plan-calc + template persistence treat this as TIME_OF_USE.
      if (!derivedRateStructure || typeof derivedRateStructure !== "object") {
        derivedRateStructure = {};
        changed = true;
      }
      if (String((derivedRateStructure as any).type ?? "") !== "TIME_OF_USE") {
        (derivedRateStructure as any).type = "TIME_OF_USE";
        changed = true;
      }
      if (
        !Array.isArray((derivedRateStructure as any).timeOfUsePeriods) ||
        (derivedRateStructure as any).timeOfUsePeriods.length === 0
      ) {
        (derivedRateStructure as any).timeOfUsePeriods = periods;
        changed = true;
      }

      if (changed) {
        solverApplied.push("TOU_UPGRADE_FROM_EXISTING_PERIODS");
      }
    } else {
      const tou = extractPeakOffPeakTouFromEflText(rawText);
      if (tou) {
        const allDays = [0, 1, 2, 3, 4, 5, 6];
        (derivedPlanRules as any).rateType = "TIME_OF_USE";
        (derivedPlanRules as any).planType = "tou";
        // Keep a sane fallback default rate even for TOU plans to avoid downstream
        // engines that still expect this field to be present.
        (derivedPlanRules as any).defaultRateCentsPerKwh =
          typeof (derivedPlanRules as any).defaultRateCentsPerKwh === "number"
            ? (derivedPlanRules as any).defaultRateCentsPerKwh
            : tou.offPeakRateCents;
        (derivedPlanRules as any).timeOfUsePeriods = [
          {
            label: "Off-Peak",
            startHour: tou.offPeakStartHour,
            endHour: tou.offPeakEndHour,
            daysOfWeek: allDays,
            months: undefined,
            rateCentsPerKwh: tou.offPeakRateCents,
            isFree: false,
          },
          {
            label: "Peak",
            startHour: tou.peakStartHour,
            endHour: tou.peakEndHour,
            daysOfWeek: allDays,
            months: undefined,
            rateCentsPerKwh: tou.peakRateCents,
            isFree: false,
          },
        ];

        // Ensure RateStructure is also upgraded so plan-calc + template persistence
        // can treat this as a real TIME_OF_USE plan (bucket-gated, deterministic).
        if (!derivedRateStructure || typeof derivedRateStructure !== "object") {
          derivedRateStructure = {};
        }
        if (typeof (derivedRateStructure as any).type !== "string") {
          (derivedRateStructure as any).type = "TIME_OF_USE";
        } else {
          (derivedRateStructure as any).type = "TIME_OF_USE";
        }
        if (
          !Array.isArray((derivedRateStructure as any).timeOfUsePeriods) ||
          (derivedRateStructure as any).timeOfUsePeriods.length === 0
        ) {
          (derivedRateStructure as any).timeOfUsePeriods = (derivedPlanRules as any).timeOfUsePeriods;
        }

        solverApplied.push("TOU_PEAK_OFFPEAK_FROM_EFL_TEXT");
      }
    }
  }

  // If nothing was applied, return quickly with the original validation.
  if (solverApplied.length === 0) {
    return {
      derivedPlanRules,
      derivedRateStructure,
      solverApplied,
      assumptionsUsed: validation?.assumptionsUsed ?? {},
      validationAfter: validation,
      solveMode: "NONE",
      queueReason: validation?.queueReason,
    };
  }

  // Re-run validator with the derived shapes. The validator itself already
  // knows how to consult the Utility/TDSP tariff table when TDSP is masked
  // on the EFL, so we do not duplicate that logic here.
  const validationAfter = await validateEflAvgPriceTable({
    rawText,
    planRules: (derivedPlanRules as PlanRules) ?? (planRules as PlanRules),
    rateStructure:
      (derivedRateStructure as RateStructure) ?? (rateStructure as RateStructure),
    toleranceCentsPerKwh: validation?.toleranceCentsPerKwh,
  });

  let solveMode: EflValidationGapSolveMode = "NONE";
  if (validationAfter.status === "PASS") {
    solveMode = "PASS_WITH_ASSUMPTIONS";
  } else if (validationAfter.status === "FAIL") {
    solveMode = "FAIL";
  }

  return {
    derivedPlanRules,
    derivedRateStructure,
    solverApplied,
    assumptionsUsed: validationAfter.assumptionsUsed,
    validationAfter,
    solveMode,
    queueReason: validationAfter.queueReason,
  };
}

function extractThresholdMinUsageCreditsFromEflText(rawText: string): Array<{
  label: string;
  creditCents: number;
  minUsageKWh: number;
}> {
  const t = String(rawText ?? "");
  if (!t.trim()) return [];

  const out: Array<{ label: string; creditCents: number; minUsageKWh: number }> = [];

  // Supports both "$35.00 per bill month" and "35.00 $ per bill month"
  const re =
    /\b(?:(Additional)\s+)?Residential\s+Usage\s+Credit\s+([0-9]+(?:\.[0-9]{1,2})?)\s*\$?\s*per\s*(?:bill\s*month|month|billing\s*cycle)[\s\S]{0,120}?\busage\s*>=\s*([0-9,]{1,6})\s*kwh\b/gi;

  const matches = Array.from(t.matchAll(re));
  for (const m of matches) {
    const isAdditional = Boolean(m?.[1]);
    const dollars = Number(m?.[2]);
    const minKwh = Number(String(m?.[3] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    if (!Number.isFinite(minKwh) || minKwh < 1) continue;

    const minUsageKWh = Math.floor(minKwh);
    const creditCents = Math.round(dollars * 100);
    const label = `${isAdditional ? "Additional " : ""}Residential Usage Credit $${dollars.toFixed(2)} applies >= ${minUsageKWh} kWh`;
    out.push({ label, creditCents, minUsageKWh });
  }

  // Dedupe exact duplicates (same threshold + same credit).
  const seen = new Set<string>();
  const uniq: typeof out = [];
  for (const r of out) {
    const k = `${r.minUsageKWh}|${r.creditCents}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  return uniq.sort((a, b) => a.minUsageKWh - b.minUsageKWh);
}

function normalizeAdditiveThresholdCreditsToSegments(
  credits: Array<{ label: string; creditCents: number; minUsageKWh: number }>,
): Array<{ label: string; creditCents: number; minUsageKWh: number; maxUsageKWh: number | null }> {
  const events = (Array.isArray(credits) ? credits : [])
    .map((c) => ({
      minUsageKWh: Math.max(0, Math.floor(Number(c.minUsageKWh))),
      creditCents: Math.max(0, Math.floor(Number(c.creditCents))),
      label: String(c.label ?? "").trim() || "Usage credit",
    }))
    .filter(
      (c) =>
        Number.isFinite(c.minUsageKWh) &&
        c.minUsageKWh >= 1 &&
        Number.isFinite(c.creditCents) &&
        c.creditCents > 0,
    )
    .sort((a, b) => a.minUsageKWh - b.minUsageKWh);

  if (events.length === 0) return [];

  // Collapse multiple events at the same threshold by summing them.
  const collapsed: typeof events = [];
  for (const e of events) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.minUsageKWh === e.minUsageKWh) {
      last.creditCents += e.creditCents;
      last.label = `${last.label} + ${e.label}`;
    } else {
      collapsed.push({ ...e });
    }
  }

  let running = 0;
  const segments: Array<{ label: string; creditCents: number; minUsageKWh: number; maxUsageKWh: number | null }> = [];
  for (let i = 0; i < collapsed.length; i++) {
    const cur = collapsed[i]!;
    const next = collapsed[i + 1] ?? null;
    running += cur.creditCents;
    if (running <= 0) continue;
    segments.push({
      label:
        running === cur.creditCents
          ? cur.label
          : `Usage credits total $${(running / 100).toFixed(2)} applies >= ${cur.minUsageKWh} kWh`,
      creditCents: running,
      minUsageKWh: cur.minUsageKWh,
      maxUsageKWh: next ? next.minUsageKWh : null,
    });
  }
  return segments;
}

function extractSingleEnergyChargeCentsPerKwhFromEflText(rawText: string): number | null {
  try {
    const t = String(rawText ?? "");
    if (!t.trim()) return null;

    // Side-by-side "Electricity Price" tables often place the TDSP delivery ¢/kWh
    // near the REP "Energy Charge" label. We must avoid accidentally picking the
    // TDSP delivery rate as the REP energy rate.
    const tdsp = (() => {
      try {
        return extractEflTdspCharges(t);
      } catch {
        return { perKwhCents: null as number | null };
      }
    })();
    const tdspPerKwhCents =
      typeof (tdsp as any)?.perKwhCents === "number" && Number.isFinite((tdsp as any).perKwhCents)
        ? (tdsp as any).perKwhCents
        : null;

    // Scan line-by-line for a real "Energy Charge" *rate* row.
    // IMPORTANT: many EFLs mention "Energy Charge discount" (e.g. "50 percent discount off the Energy Charge"),
    // which must NOT be parsed as the ¢/kWh rate.
    const lines = t.split(/\r?\n/).map((l) => String(l ?? "").trim());

    const looksLikeDiscountLine = (s: string): boolean =>
      /\b(discount|percent|%)\b/i.test(s) && /Energy\s*Charge/i.test(s);

    const isNearTdsp = (rateCents: number): boolean => {
      if (tdspPerKwhCents == null) return false;
      // Tolerate minor formatting/rounding differences between EFL tokens and our TDSP extractor.
      return Math.abs(rateCents - tdspPerKwhCents) <= 0.02;
    };

    const pickRepRateFromCandidates = (rates: number[]): number | null => {
      const xs = rates
        .filter((v) => Number.isFinite(v))
        .filter((v) => v > 0 && v < 200);
      if (xs.length === 0) return null;

      // If multiple ¢/kWh tokens are present and one matches TDSP delivery, pick the other.
      const withoutTdsp = tdspPerKwhCents != null ? xs.filter((v) => !isNearTdsp(v)) : xs.slice();
      if (withoutTdsp.length === 1) return withoutTdsp[0]!;

      // If there is exactly one token and it matches TDSP, reject (likely we captured delivery).
      if (xs.length === 1 && tdspPerKwhCents != null && isNearTdsp(xs[0]!)) return null;

      // Heuristic fallback: prefer the largest rate on the assumption that REP energy is usually
      // >= TDSP delivery in these table formats. This is only reached when we cannot disambiguate.
      return withoutTdsp.length > 0 ? Math.max(...withoutTdsp) : Math.max(...xs);
    };

    const parsePerKwhRates = (s: string): number[] => {
      const line = String(s ?? "");
      if (!/per\s*kwh|\/\s*kwh/i.test(line)) return [];
      if (looksLikeDiscountLine(line)) return [];
      if (/Delivery/i.test(line) || /TDSP/i.test(line) || /TDU/i.test(line)) return [];

      // Cents form: "17.06¢ per kWh" / "17.06 ¢/kWh"
      const centsAll = Array.from(
        line.matchAll(/([0-9]{1,3}(?:\.[0-9]{1,6})?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/gi),
      )
        .map((m) => Number(m?.[1]))
        .filter((n) => Number.isFinite(n));

      // Dollar form: "$0.1706 per kWh" / "per kWh $0.1706"
      const dollarAll = Array.from(
        line.matchAll(/\$\s*([0-9]{1,3}(?:\.[0-9]{1,6})?)\s*(?:\/\s*kwh|per\s*kwh)/gi),
      )
        .map((m) => Number(m?.[1]))
        .filter((n) => Number.isFinite(n))
        .map((dollars) => dollars * 100);

      const dm2All = Array.from(
        line.matchAll(/per\s*kwh[^0-9$]{0,30}\$?\s*([0-9]{1,3}(?:\.[0-9]{1,6})?)/gi),
      )
        .map((m) => Number(m?.[1]))
        .filter((n) => Number.isFinite(n))
        .map((raw) => (raw <= 2 ? raw * 100 : raw));

      return [...centsAll, ...dollarAll, ...dm2All];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line) continue;
      if (!/Energy\s*Charge/i.test(line)) continue;
      // Avoid TOU peak/off-peak variants.
      if (/\bpeak\b|\boff[-\s]?peak\b/i.test(line)) continue;
      // Skip "discount" narrative lines that mention Energy Charge but are not rate rows.
      if (looksLikeDiscountLine(line)) continue;

      // Try the line itself first.
      const directRates = parsePerKwhRates(line);
      const direct = pickRepRateFromCandidates(directRates);
      if (direct != null) return direct;

      // Table-style: the numeric token can be on a subsequent line near the Energy Charge header.
      for (let j = 1; j <= 6; j++) {
        const next = lines[i + j] ?? "";
        if (!next) continue;
        const joined = `${line} ${next}`;
        const rates = parsePerKwhRates(joined);
        const v = pickRepRateFromCandidates(rates);
        if (v != null) return v;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function extractSingleEnergyChargeCentsPerKwhFromRateStructure(rs: any): number | null {
  try {
    if (!rs || typeof rs !== "object") return null;

    // Some AI parses return a non-canonical shape like:
    //   { energyCharges: [{ rate: 22.99, unit: "¢/kWh", ... }], ... }
    const energyCharges: any[] = Array.isArray((rs as any).energyCharges)
      ? (rs as any).energyCharges
      : [];
    if (!energyCharges.length) return null;

    const first = energyCharges[0];
    const rateRaw = Number(first?.rate);
    if (!Number.isFinite(rateRaw) || rateRaw < 0) return null;

    // Heuristic: <=2 is likely $/kWh, otherwise cents/kWh.
    return rateRaw <= 2 ? rateRaw * 100 : rateRaw;
  } catch {
    return null;
  }
}

function monthNameToNumber(s: string): number | null {
  const t = String(s ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return map[t] ?? null;
}

function extractSeasonalEnergyDiscount(text: string): { discountPct: number; months: number[] } | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  // Example:
  // "You will receive a 50 percent discount off the Energy Charge ... from June 1 ... through September 30 ..."
  const pctMatch = raw.match(/([0-9]{1,3})\s*(?:percent|%)\s*discount\s*off\s*the\s*Energy\s*Charge/i);
  if (!pctMatch?.[1]) return null;
  const pct = Number(pctMatch[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;

  const fromMatch = raw.match(/\bfrom\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})/i);
  const throughMatch = raw.match(/\bthrough\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})/i);
  if (!fromMatch?.[1] || !throughMatch?.[1]) return null;

  const startMonth = monthNameToNumber(fromMatch[1]);
  const endMonth = monthNameToNumber(throughMatch[1]);
  if (!startMonth || !endMonth) return null;

  const months: number[] = [];
  if (startMonth <= endMonth) {
    for (let m = startMonth; m <= endMonth; m++) months.push(m);
  } else {
    for (let m = startMonth; m <= 12; m++) months.push(m);
    for (let m = 1; m <= endMonth; m++) months.push(m);
  }

  return { discountPct: pct / 100, months };
}

// Simple masked-TDSP detector used only for solverApplied/debugging.
function detectMaskedTdsp(rawText: string): boolean {
  const t = rawText.toLowerCase();
  const hasStars = t.includes("**");
  if (!hasStars) return false;

  const hasPassThrough =
    /tdu\s+delivery\s+charges/i.test(rawText) ||
    /tdu\s+charges/i.test(rawText) ||
    /tdsp\s+charges/i.test(rawText) ||
    /passed\s+through/i.test(t) ||
    /passed-through/i.test(t);

  return hasStars && hasPassThrough;
}

// Deterministic tier extractor mirroring the core Energy Charge parsing used
// by the EFL extractor. This is intentionally duplicated at a high level so
// the solver can recover from cases where only the first tier made it into
// PlanRules but the raw text clearly lists multiple tiers.
function extractUsageTiersFromEflText(rawText: string): Array<{
  minKwh: number;
  maxKwh: number | null;
  rateCentsPerKwh: number;
}> {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  type Tier = { minKwh: number; maxKwh: number | null; rateCentsPerKwh: number };
  const tiers: Tier[] = [];

  // Line-based patterns:
  //   "0 - 1200 kWh 12.5000¢"
  //   "> 1200 kWh 20.4000¢"
  const rangeRe =
    /^(\d{1,6})\s*-\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;
  const gtRe = />\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;

  // Anchor search window near "Energy Charge" lines.
  const anchorIdx = lines.findIndex((l) => /Energy\s*Charge/i.test(l));
  const search = anchorIdx >= 0 ? lines.slice(anchorIdx, anchorIdx + 80) : lines;

  const centsFrom = (raw: string): number | null => {
    const cleaned = raw.replace(/,/g, "");
    const m = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!m?.[1]) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  for (const l of search) {
    let m = l.match(rangeRe);
    if (m?.[1] && m?.[2] && m?.[3]) {
      const minKwh = Number(m[1]);
      const maxKwh = Number(m[2]);
      const rate = centsFrom(m[3]);
      if (
        Number.isFinite(minKwh) &&
        Number.isFinite(maxKwh) &&
        rate != null
      ) {
        tiers.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
      }
      continue;
    }

    m = l.match(gtRe);
    if (m?.[1] && m?.[2]) {
      const boundary = Number(m[1]);
      const minKwh = Number.isFinite(boundary) ? boundary + 1 : boundary;
      const rate = centsFrom(m[2]);
      if (Number.isFinite(minKwh) && rate != null) {
        tiers.push({ minKwh, maxKwh: null, rateCentsPerKwh: rate });
      }
    }
  }

  // Also handle bracketed tiers as seen in some Rhythm-style EFLs:
  //   "Energy Charge: (0 to 1000 kWh) 10.9852¢ per kWh"
  //   "Energy Charge: (> 1000 kWh) 12.9852¢ per kWh"
  const bracketRe =
    /Energy\s*Charge\s*:\s*\(\s*(>?)\s*([0-9,]+)(?:\s*to\s*([0-9,]+))?\s*kwh\s*\)\s*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:per|\/)\s*kwh/gi;

  let mBracket: RegExpExecArray | null;
  while ((mBracket = bracketRe.exec(rawText)) !== null) {
    const isGt = !!mBracket[1];
    const a = Number(mBracket[2].replace(/,/g, ""));
    const b = mBracket[3] ? Number(mBracket[3].replace(/,/g, "")) : null;
    const rate = centsFrom(mBracket[4]);
    if (!Number.isFinite(a) || (b != null && !Number.isFinite(b)) || rate == null) {
      continue;
    }
    const minKwh = isGt ? a + 1 : a;
    const maxKwh = isGt ? null : b;
    tiers.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
  }

  // De-dup + sort by minKwh.
  const uniq = new Map<string, Tier>();
  for (const t of tiers) {
    const key = `${t.minKwh}|${t.maxKwh ?? "null"}|${t.rateCentsPerKwh}`;
    if (!uniq.has(key)) uniq.set(key, t);
  }

  return Array.from(uniq.values()).sort((a, b) => a.minKwh - b.minKwh);
}

// Deterministic base charge extractor (solver-only) mirroring the patterns in
// the main EFL extractor. This is intentionally local so the solver can fill
// in missing baseChargePerMonthCents/baseMonthlyFeeCents before re-validating.
function extractBaseChargeCentsFromEflText(rawText: string): number | null {
  const text = rawText || "";

  // Treat explicit N/A as "not present", not zero.
  if (/Base\s*(?:Monthly\s+)?Charge[^.\n]*\bN\/A\b|\bNA\b/i.test(text)) {
    return null;
  }

  // Explicit $0 per billing cycle/month.
  if (
    /Base\s*(?:Monthly\s+)?Charge\s*:\s*\$0\b[\s\S]{0,40}?per\s*(?:billing\s*cycle|month)/i.test(
      text,
    )
  ) {
    return 0;
  }

  // Variant: "Base Charge of $4.95 per ESI-ID will apply each billing cycle."
  {
    const ofRe =
      /Base\s+(?:Monthly\s+)?Charge\s+of\s*(?!.*\bN\/A\b)\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+ESI-?ID)?[\s\S]{0,60}?(?:will\s+apply)?\s*(?:each\s+billing\s+cycle|per\s+billing\s+cycle|per\s+month|\/\s*month|monthly)/i;
    const m = text.match(ofRe);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return Math.round(dollars * 100);
      }
    }
  }

  // Generic "Base Charge: $X per billing cycle/month" including "Base Monthly Charge".
  {
    const generic =
      /Base\s*(?:Monthly\s+)?Charge(?:\s*of)?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,80}?(?:per\s+(?:billing\s*cycle|month))/i;
    const m = text.match(generic);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return Math.round(dollars * 100);
      }
    }
  }

  return null;
}

function extractMonthlyServiceFeeCutoff(rawText: string): { feeCents: number; maxUsageKwh: number } | null {
  const t = rawText || "";
  // Example:
  // "Monthly Service Fee                                      $8.00 per billing cycle for usage ( <=1999) kWh"
  const reMonthlyServiceFee =
    /Monthly\s+Service\s+Fee[\s\S]{0,120}?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+billing\s*cycle|per\s+month|monthly)[\s\S]{0,160}?\(\s*<=\s*([0-9]{1,6})\s*\)\s*kwh/i;
  const m1 = t.match(reMonthlyServiceFee);
  if (m1?.[1] && m1?.[2]) {
    const dollars = Number(m1[1]);
    const maxKwh = Number(String(m1[2]).replace(/,/g, ""));
    if (!Number.isFinite(dollars) || !Number.isFinite(maxKwh) || maxKwh <= 0) return null;
    return { feeCents: Math.round(dollars * 100), maxUsageKwh: Math.round(maxKwh) };
  }

  // Common variant in some EFLs:
  // "Usage Charge: $9.95 per billing cycle < 1,000 kWh"
  const reUsageChargeLt =
    /Usage\s+Charge\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+billing\s*cycle|per\s+month|monthly)[\s\S]{0,80}?<\s*([0-9,]{1,6})\s*kwh/i;
  const m2 = t.match(reUsageChargeLt);
  if (m2?.[1] && m2?.[2]) {
    const dollars = Number(m2[1]);
    const ltKwh = Number(String(m2[2]).replace(/,/g, ""));
    if (!Number.isFinite(dollars) || !Number.isFinite(ltKwh) || ltKwh <= 1) return null;
    // "< 1000 kWh" means the fee applies at most up to 999 kWh.
    return { feeCents: Math.round(dollars * 100), maxUsageKwh: Math.round(ltKwh - 1) };
  }

  return null;
}

function baseFeeInferredFromValidation(args: {
  validation: EflAvgPriceValidation;
  feeCents: number;
  maxUsageKwh: number;
}): boolean {
  const { validation, feeCents, maxUsageKwh } = args;
  const tol = typeof validation.toleranceCentsPerKwh === "number" ? validation.toleranceCentsPerKwh : 0.25;
  const pts: any[] = Array.isArray(validation.points) ? validation.points : [];
  if (pts.length < 2) return true; // best-effort

  // Require at least one "above cutoff" point that's already basically OK (otherwise this rule isn't a fit).
  const aboveOk = pts.some((p) => {
    const u = Number(p?.usageKwh);
    const diff = Number(p?.diffCentsPerKwh);
    if (!Number.isFinite(u) || !Number.isFinite(diff)) return false;
    if (u <= maxUsageKwh) return false;
    return Math.abs(diff) <= Math.max(tol, 0.35);
  });
  if (!aboveOk) return false;

  // Compare inferred missing cents for points at/below cutoff.
  const inferred: number[] = [];
  for (const p of pts) {
    const u = Number(p?.usageKwh);
    const diff = Number(p?.diffCentsPerKwh); // modeled - expected
    if (!Number.isFinite(u) || !Number.isFinite(diff)) continue;
    if (u > maxUsageKwh) continue;
    // We only care about cases where modeled is too low.
    if (diff >= 0) continue;
    const impliedMissingCents = Math.round((-diff) * u);
    if (Number.isFinite(impliedMissingCents)) inferred.push(impliedMissingCents);
  }
  if (inferred.length === 0) return false;

  const avg = inferred.reduce((a, b) => a + b, 0) / inferred.length;
  // Accept if inferred missing fee is within ~$0.75 of the stated fee.
  return Math.abs(avg - feeCents) <= 75;
}

function extractDailyCharge(rawText: string): { dailyDollars: number } | null {
  const t = rawText || "";
  const m = t.match(/Daily\s+Charge[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*per\s*day/i);
  if (!m?.[1]) return null;
  const d = Number(m[1]);
  if (!Number.isFinite(d) || d <= 0) return null;
  return { dailyDollars: d };
}

function extractMonthlyCreditMaxUsage(rawText: string): { creditDollars: number; maxUsageKwh: number } | null {
  const t = rawText || "";
  // Example: "Monthly Credit     -$15.00     Applies: 500 kWh usage or less"
  const m = t.match(
    /Monthly\s+Credit[\s\S]{0,80}?-?\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,120}?Applies\s*:\s*([0-9,]{1,6})\s*kwh[\s\S]{0,40}?(?:or\s+less|usage\s+or\s+less|usage\s+or\s+lower)/i,
  );
  if (!m?.[1] || !m?.[2]) return null;
  const dollars = Number(m[1]);
  const maxKwh = Number(String(m[2]).replace(/,/g, ""));
  if (!Number.isFinite(dollars) || !Number.isFinite(maxKwh) || dollars <= 0 || maxKwh <= 0) return null;
  return { creditDollars: dollars, maxUsageKwh: Math.round(maxKwh) };
}

function extractPeakOffPeakTouFromEflText(rawText: string): {
  peakRateCents: number;
  offPeakRateCents: number;
  peakStartHour: number;
  peakEndHour: number;
  offPeakStartHour: number;
  offPeakEndHour: number;
  offPeakUsagePercent: number;
} | null {
  const t = rawText || "";

  const peakRate =
    t.match(/Energy\s*Charge\s*Peak\s*([0-9]+(?:\.[0-9]+)?)\s*¢/i) ??
    t.match(/Peak\s*Energy\s*Charge\s*([0-9]+(?:\.[0-9]+)?)\s*¢/i) ??
    null;
  const offRate =
    t.match(/Energy\s*Charge\s*Off-?\s*Peak\s*([0-9]+(?:\.[0-9]+)?)\s*¢/i) ??
    t.match(/Off-?\s*Peak\s*Energy\s*Charge\s*([0-9]+(?:\.[0-9]+)?)\s*¢/i) ??
    null;
  if (!peakRate?.[1] || !offRate?.[1]) return null;

  const peakRateCents = Number(peakRate[1]);
  const offPeakRateCents = Number(offRate[1]);
  if (!Number.isFinite(peakRateCents) || !Number.isFinite(offPeakRateCents)) return null;

  // Usage split assumption (required to match avg-table and to safely upgrade templates).
  // Some EFLs use decimals (e.g. 37.5%).
  const pct =
    t.match(/([0-9]{1,3}(?:\.[0-9]+)?)%\s+of\s+Off-?Peak\s+consumption/i) ??
    t.match(/([0-9]{1,3}(?:\.[0-9]+)?)%\s+of\s+Off-?Peak\b/i) ??
    null;
  if (!pct?.[1]) return null;
  const offPeakUsagePercent = Number(pct[1]) / 100;
  if (
    !Number.isFinite(offPeakUsagePercent) ||
    offPeakUsagePercent <= 0 ||
    offPeakUsagePercent >= 1
  ) {
    return null;
  }

  // Hours parsing: prefer explicit Off-Peak hours, then Peak hours.
  const offHours =
    t.match(
      /Off-?Peak\s+hours?\s+are\s+([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ?? null;
  const peakHours =
    t.match(
      // Require whitespace or start before "Peak" so we don't accidentally match "Off-Peak hours are ..."
      /(?:^|\s)Peak\s+hours?\s+are\s+([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ?? null;

  const to24 = (hh: string, mm: string, ap: string): number | null => {
    let h = Number(hh);
    const minute = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(minute)) return null;
    const isPm = ap.toUpperCase() === "PM";
    if (h === 12) h = isPm ? 12 : 0;
    else h = isPm ? h + 12 : h;
    return h;
  };
  const to24EndExclusive = (hh: string, mm: string, ap: string): number | null => {
    const base = to24(hh, mm, ap);
    if (base == null) return null;
    const minute = Number(mm);
    if (!Number.isFinite(minute)) return base;
    if (minute > 0) return (base + 1) % 24;
    return base;
  };

  // Default to common peak/off-peak split when times are present but parsing fails.
  let offPeakStartHour = 21;
  let offPeakEndHour = 5;
  let peakStartHour = 5;
  let peakEndHour = 21;

  if (offHours) {
    const s = to24(offHours[1], offHours[2], offHours[3]);
    const e = to24EndExclusive(offHours[4], offHours[5], offHours[6]);
    if (s != null && e != null) {
      offPeakStartHour = s;
      offPeakEndHour = e;
    }
  }
  if (peakHours) {
    const s = to24(peakHours[1], peakHours[2], peakHours[3]);
    const e = to24EndExclusive(peakHours[4], peakHours[5], peakHours[6]);
    if (s != null && e != null) {
      peakStartHour = s;
      peakEndHour = e;
    }
  }

  return {
    peakRateCents: peakRateCents,
    offPeakRateCents: offPeakRateCents,
    peakStartHour,
    peakEndHour,
    offPeakStartHour,
    offPeakEndHour,
    offPeakUsagePercent,
  };
}


