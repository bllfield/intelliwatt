export type EflAveragePriceAnchors = {
  centsPerKwhAt500: number | null;
  centsPerKwhAt1000: number | null;
  centsPerKwhAt2000: number | null;
};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clampCents(v: number | null): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  // ¢/kWh sanity
  if (v <= 0 || v > 200) return null;
  return v;
}

export function detectIndexedOrVariable(rateStructure: any): {
  isIndexed: boolean;
  kind: "INDEXED" | "VARIABLE" | null;
  notes: string[];
} {
  const notes: string[] = [];
  if (!rateStructure || !isObject(rateStructure)) return { isIndexed: false, kind: null, notes };

  const rs: any = rateStructure;

  // Avoid misclassifying TOU templates.
  if (Array.isArray(rs?.timeOfUsePeriods) && rs.timeOfUsePeriods.length > 0) {
    notes.push("timeOfUsePeriods present (not treating as indexed/variable).");
    return { isIndexed: false, kind: null, notes };
  }
  if (Array.isArray(rs?.timeOfUseTiers) && rs.timeOfUseTiers.length > 0) {
    notes.push("timeOfUseTiers present (not treating as indexed/variable).");
    return { isIndexed: false, kind: null, notes };
  }
  if (Array.isArray(rs?.planRules?.timeOfUsePeriods) && rs.planRules.timeOfUsePeriods.length > 0) {
    notes.push("planRules.timeOfUsePeriods present (not treating as indexed/variable).");
    return { isIndexed: false, kind: null, notes };
  }

  const typeUpper = String(rs?.type ?? "").trim().toUpperCase();
  const planRulesRateTypeUpper = String(rs?.planRules?.rateType ?? "").trim().toUpperCase();

  if (typeUpper === "INDEXED") return { isIndexed: true, kind: "INDEXED", notes: ["rateStructure.type=INDEXED"] };
  if (typeUpper === "VARIABLE") return { isIndexed: true, kind: "VARIABLE", notes: ["rateStructure.type=VARIABLE"] };
  if (planRulesRateTypeUpper === "VARIABLE") {
    return { isIndexed: true, kind: "VARIABLE", notes: ["planRules.rateType=VARIABLE"] };
  }

  // Conservative heuristic only when explicit fields are present.
  const hasIndexType = typeof rs?.indexType === "string" && rs.indexType.trim().length > 0;
  const hasCurrentBill = safeNum(rs?.currentBillEnergyRateCents) != null || safeNum(rs?.planRules?.currentBillEnergyRateCents) != null;
  if (hasIndexType) notes.push("indexType present");
  if (hasCurrentBill) notes.push("currentBillEnergyRateCents present");

  if (hasIndexType || hasCurrentBill) {
    return { isIndexed: true, kind: "INDEXED", notes };
  }

  // Last resort token checks (kept strict; avoid false positives).
  const hay = [
    rs?.planName,
    rs?.supplier,
    rs?.planType,
    rs?.productType,
    rs?.typeOfProduct,
    rs?.indexType,
  ]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const tokenHit =
    /\b(indexed|index)\b/.test(hay) ||
    /\b(variable)\b/.test(hay) ||
    /\b(ercot)\b/.test(hay) ||
    /\b(rtm|dam)\b/.test(hay) ||
    /\b(market)\b/.test(hay);
  if (tokenHit) {
    return { isIndexed: true, kind: /\b(variable)\b/.test(hay) ? "VARIABLE" : "INDEXED", notes: ["token_match"] };
  }

  return { isIndexed: false, kind: null, notes };
}

export function extractEflAveragePriceAnchors(rateStructure: any): EflAveragePriceAnchors {
  if (!rateStructure || !isObject(rateStructure)) {
    return { centsPerKwhAt500: null, centsPerKwhAt1000: null, centsPerKwhAt2000: null };
  }
  const rs: any = rateStructure;

  // A) Direct modeled rate fields (sometimes embedded for tooling).
  const direct500 = clampCents(safeNum(rs?.modeledRate500));
  const direct1000 = clampCents(safeNum(rs?.modeledRate1000));
  const direct2000 = clampCents(safeNum(rs?.modeledRate2000));

  // B) Embedded validation proof in template (preferred): __eflAvgPriceValidation.points[*].modeledAvgCentsPerKwh
  const points: any[] = Array.isArray(rs?.__eflAvgPriceValidation?.points) ? rs.__eflAvgPriceValidation.points : [];
  const modeledPick = (kwh: number): number | null => {
    const hit = points.find((p) => Number(p?.usageKwh ?? p?.kwh ?? p?.usage) === kwh);
    // IMPORTANT: Prefer supply-only anchors when available so we can apply the *home’s* TDSP charges
    // without double-counting TDSP included in the EFL avg-price table.
    //
    // The validator proof often contains:
    // - modeled.supplyOnlyTotalCents (REP only)
    // - modeled.tdspTotalCentsUsed / modeled.totalCentsUsed (all-in)
    //
    // For indexed/variable APPROX mode we need REP cents/kWh, not all-in cents/kWh.
    const usageKwh = safeNum(hit?.usageKwh ?? hit?.kwh ?? hit?.usage);
    const supplyOnlyTotalCents = safeNum(hit?.modeled?.supplyOnlyTotalCents);
    if (usageKwh != null && usageKwh > 0 && supplyOnlyTotalCents != null && supplyOnlyTotalCents > 0) {
      const repCentsPerKwh = supplyOnlyTotalCents / usageKwh;
      return clampCents(repCentsPerKwh);
    }

    const v = safeNum(
      hit?.modeledAvgCentsPerKwh ??
        hit?.modeledAvgPriceCentsPerKwh ??
        hit?.modeledCentsPerKwh,
    );
    return clampCents(v);
  };

  const fromProof500 = modeledPick(500);
  const fromProof1000 = modeledPick(1000);
  const fromProof2000 = modeledPick(2000);

  return {
    centsPerKwhAt500: fromProof500 ?? direct500 ?? null,
    centsPerKwhAt1000: fromProof1000 ?? direct1000 ?? null,
    centsPerKwhAt2000: fromProof2000 ?? direct2000 ?? null,
  };
}

export function chooseEffectiveCentsPerKwhFromAnchors(args: {
  annualKwh: number;
  anchors: EflAveragePriceAnchors;
}):
  | { ok: true; centsPerKwh: number; method: string; notes: string[] }
  | { ok: false; reason: "MISSING_EFL_ANCHORS"; notes: string[] } {
  const notes: string[] = [];
  const annual = safeNum(args.annualKwh);
  if (annual == null || annual <= 0) return { ok: false, reason: "MISSING_EFL_ANCHORS", notes: ["invalid_annualKwh"] };

  const monthly = annual / 12;
  notes.push(`monthlyKwh=${monthly.toFixed(2)}`);

  const a500 = clampCents(args.anchors.centsPerKwhAt500);
  const a1000 = clampCents(args.anchors.centsPerKwhAt1000);
  const a2000 = clampCents(args.anchors.centsPerKwhAt2000);

  const available: Array<{ kwh: number; cents: number }> = [];
  if (a500 != null) available.push({ kwh: 500, cents: a500 });
  if (a1000 != null) available.push({ kwh: 1000, cents: a1000 });
  if (a2000 != null) available.push({ kwh: 2000, cents: a2000 });

  if (available.length === 0) return { ok: false, reason: "MISSING_EFL_ANCHORS", notes: ["no_anchors_present"] };

  // Exact hits
  if (Math.abs(monthly - 500) < 1e-6 && a500 != null) return { ok: true, centsPerKwh: a500, method: "EXACT_500", notes };
  if (Math.abs(monthly - 1000) < 1e-6 && a1000 != null) return { ok: true, centsPerKwh: a1000, method: "EXACT_1000", notes };
  if (Math.abs(monthly - 2000) < 1e-6 && a2000 != null) return { ok: true, centsPerKwh: a2000, method: "EXACT_2000", notes };

  // Interpolate between bracketing anchors when both exist.
  if (monthly > 500 && monthly < 1000 && a500 != null && a1000 != null) {
    const t = (monthly - 500) / 500;
    const cents = a500 + (a1000 - a500) * t;
    return { ok: true, centsPerKwh: cents, method: "INTERP_500_1000", notes };
  }
  if (monthly > 1000 && monthly < 2000 && a1000 != null && a2000 != null) {
    const t = (monthly - 1000) / 1000;
    const cents = a1000 + (a2000 - a1000) * t;
    return { ok: true, centsPerKwh: cents, method: "INTERP_1000_2000", notes };
  }

  // Otherwise choose the closest available anchor.
  available.sort((x, y) => Math.abs(x.kwh - monthly) - Math.abs(y.kwh - monthly));
  const best = available[0]!;
  return { ok: true, centsPerKwh: best.cents, method: `CLOSEST_${best.kwh}`, notes };
}

