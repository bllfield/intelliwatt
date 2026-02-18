"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { EstimateBreakdownPopover } from "../../components/ui/EstimateBreakdownPopover";
import { PlanDisclosuresPopover } from "@/app/components/ui/PlanDisclosuresPopover";

type OfferRow = {
  offerId: string;
  supplierName?: string;
  planName?: string;
  termMonths?: number;
  rateType?: string;
  renewablePercent?: number;
  earlyTerminationFeeDollars?: number;
  baseMonthlyFeeDollars?: number;
  efl: {
    avgPriceCentsPerKwh500?: number;
    avgPriceCentsPerKwh1000?: number;
    avgPriceCentsPerKwh2000?: number;
    eflUrl?: string;
    tosUrl?: string;
    yracUrl?: string;
  };
  disclosures?: {
    supplierPuctRegistration?: string | null;
    supplierContactEmail?: string | null;
    supplierContactPhone?: string | null;
    cancellationFeeText?: string | null;
    tosUrl?: string | null;
    yracUrl?: string | null;
  };
  intelliwatt: {
    templateAvailable: boolean;
    ratePlanId?: string;
    // Internal server status; customer UI maps this to friendly language.
    statusLabel: "AVAILABLE" | "QUEUED";
    statusReason?: string | null;
    usageKwhPerMonth?: number;
    trueCostEstimate?:
      | {
          status: "OK";
          annualCostDollars: number;
          monthlyCostDollars: number;
          effectiveCentsPerKwh?: number;
          confidence?: "LOW" | "MEDIUM";
          componentsV2?: {
            rep?: {
              energyDollars?: number;
              fixedDollars?: number;
              creditsDollars?: number;
              totalDollars?: number;
            };
            tdsp?: {
              deliveryDollars?: number;
              fixedDollars?: number;
              totalDollars?: number;
            };
            totalDollars?: number;
          };
        }
      | {
          status: "APPROXIMATE";
          annualCostDollars: number;
          monthlyCostDollars: number;
          effectiveCentsPerKwh?: number;
          confidence?: "LOW" | "MEDIUM";
          componentsV2?: any;
        }
      | { status: "MISSING_USAGE" }
      | { status: "MISSING_TEMPLATE" }
      | { status: "NOT_COMPUTABLE"; reason?: string }
      | { status: "NOT_IMPLEMENTED" };
    tdspRatesApplied?:
      | {
          effectiveDate?: string;
          perKwhDeliveryChargeCents?: number;
          monthlyCustomerChargeDollars?: number;
        }
      | null;
  };
  utility?: { tdspSlug?: string; utilityName?: string };
};

export type OfferCardProps = {
  offer: OfferRow;
  recommended?: boolean;
};

function fmtCents(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}¢`;
}

function fmtDollars2(v: number | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v.toFixed(2);
}

function badgeClasses(kind: "AVAILABLE" | "CALCULATING" | "NEED_USAGE" | "NOT_COMPUTABLE_YET"): string {
  if (kind === "AVAILABLE") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (kind === "CALCULATING") return "border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan";
  if (kind === "NEED_USAGE") return "border-brand-blue/30 bg-brand-blue/10 text-brand-navy";
  return "border-amber-400/40 bg-amber-500/10 text-amber-200";
}

export default function OfferCard({ offer, recommended }: OfferCardProps) {
  const router = useRouter();
  const supplier = offer.supplierName ?? "Unknown supplier";
  const plan = offer.planName ?? "Unknown plan";
  const term = typeof offer.termMonths === "number" ? `${offer.termMonths} mo` : "Term —";
  const renewable =
    typeof offer.renewablePercent === "number" && Number.isFinite(offer.renewablePercent)
      ? `${Math.round(offer.renewablePercent)}% renewable`
      : null;
  const rateType = offer.rateType ? offer.rateType.toUpperCase() : null;

  const eflUrl = offer.efl?.eflUrl;
  const tosUrl = offer.efl?.tosUrl ?? (offer as any)?.disclosures?.tosUrl ?? null;
  const yracUrl = offer.efl?.yracUrl ?? (offer as any)?.disclosures?.yracUrl ?? null;
  const status = offer.intelliwatt.statusLabel;
  const tce = offer.intelliwatt?.trueCostEstimate as any;
  const planCompStatus = String((offer as any)?.intelliwatt?.planComputability?.status ?? "").toUpperCase();
  const planCompReason = String((offer as any)?.intelliwatt?.planComputability?.reasonCode ?? "").toUpperCase();
  const tceStatus = String(tce?.status ?? "").toUpperCase();
  const tceReason = String(tce?.reason ?? offer.intelliwatt?.statusReason ?? "").toUpperCase();
  const isTemplateLookupError = tceStatus === "NOT_IMPLEMENTED" && tceReason === "TEMPLATE_LOOKUP_ERROR";
  const isMissingBuckets = tceStatus === "NOT_IMPLEMENTED" && tceReason === "MISSING_BUCKETS";

  // Only show the scary UNSUPPORTED tag for true template/engine limitations.
  // Missing templates / cache misses / missing buckets should read as CALCULATING, not UNSUPPORTED.
  const isUnsupported =
    (planCompStatus === "NOT_COMPUTABLE" &&
      (planCompReason.startsWith("UNSUPPORTED") ||
        planCompReason.startsWith("NON_DETERMINISTIC") ||
        planCompReason.includes("UNSUPPORTED"))) ||
    tceStatus === "NOT_COMPUTABLE";

  // Customer-facing status language (never show "QUEUED").
  const isCalculating =
    // Plans list is read-only: a CACHE_MISS means "pipeline hasn't materialized this input-set yet".
    (tceStatus === "NOT_IMPLEMENTED" &&
      (tceReason === "CACHE_MISS" ||
        tceReason.includes("MISSING TEMPLATE") ||
        tceReason.includes("MISSING BUCKET"))) ||
    // Template missing can be transient (prefetch/pipeline may be building it); treat as calculating on the card.
    tceStatus === "MISSING_TEMPLATE" ||
    // Backend says QUEUED but no estimate yet → still processing.
    (status === "QUEUED" && !(tce?.status === "OK" || tce?.status === "APPROXIMATE") && !isUnsupported);

  const statusKind: "AVAILABLE" | "CALCULATING" | "NEED_USAGE" | "NOT_COMPUTABLE_YET" =
    tceStatus === "MISSING_USAGE"
      ? "NEED_USAGE"
      : isMissingBuckets
        ? "NEED_USAGE"
        : status === "AVAILABLE" && (tce?.status === "OK" || tce?.status === "APPROXIMATE")
          ? "AVAILABLE"
          : isCalculating
            ? "CALCULATING"
            : "NOT_COMPUTABLE_YET";
  const statusText =
    statusKind === "NEED_USAGE"
      ? "NEED USAGE"
      : statusKind === "AVAILABLE"
        ? "AVAILABLE"
        : statusKind === "CALCULATING"
          ? "CALCULATING"
          : isTemplateLookupError
            ? "TEMPORARILY UNAVAILABLE"
            : "NOT COMPUTABLE YET";

  // tce already read above
  const showEstimateLine = tce?.status === "OK" || tce?.status === "APPROXIMATE";
  const estimateMonthly = showEstimateLine ? fmtDollars2((tce as any)?.monthlyCostDollars) : null;
  const tdspTag = offer.intelliwatt?.tdspRatesApplied ? "incl. TDSP" : null;
  const usageTag =
    typeof offer.intelliwatt?.usageKwhPerMonth === "number" && Number.isFinite(offer.intelliwatt.usageKwhPerMonth)
      ? `based on your historic usage of ${Math.round(offer.intelliwatt.usageKwhPerMonth)} kWh/mo`
      : null;
  const c2 = showEstimateLine ? (tce as any)?.componentsV2 : null;
  const tdspEffective = offer.intelliwatt?.tdspRatesApplied?.effectiveDate ?? null;
  const repAnnualDollarsRaw = c2?.rep?.energyDollars ?? (tce as any)?.annualCostDollars;
  const totalAnnualDollarsRaw = c2?.totalDollars ?? (tce as any)?.annualCostDollars;
  const distributorName = offer.utility?.utilityName ?? (offer.utility?.tdspSlug ? offer.utility.tdspSlug.toUpperCase() : null);
  const cancellationFeeText =
    typeof (offer as any)?.disclosures?.cancellationFeeText === "string" && (offer as any).disclosures.cancellationFeeText.trim()
      ? (offer as any).disclosures.cancellationFeeText.trim()
      : null;

  return (
    <div
      className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-5 shadow-[0_18px_40px_rgba(10,20,60,0.35)] cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/dashboard/plans/${encodeURIComponent(offer.offerId)}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/dashboard/plans/${encodeURIComponent(offer.offerId)}`);
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-brand-cyan/70 truncate">{supplier}</div>
          <div className="mt-1 text-lg font-semibold text-brand-white truncate">{plan}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-cyan/70">
            <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">{term}</span>
            {rateType ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">
                {rateType}
              </span>
            ) : null}
            {renewable ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">
                {renewable}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {recommended ? (
            <div
              className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-emerald-200"
              title="Lowest estimated monthly total"
            >
              RECOMMENDED
            </div>
          ) : null}
          <div
            className={`rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${badgeClasses(
              statusKind,
            )}`}
            title={offer.intelliwatt.ratePlanId ? `RatePlan: ${offer.intelliwatt.ratePlanId}` : undefined}
          >
            {statusText}
          </div>

          {isUnsupported ? (
            <div className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200">
              UNSUPPORTED
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {eflUrl ? (
              <Link
                href={eflUrl}
                target="_blank"
                rel="noreferrer"
                className="link-brand text-xs font-semibold hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                View EFL
              </Link>
            ) : (
              <div className="text-xs text-brand-cyan/60">No EFL link</div>
            )}

            {tosUrl ? (
              <Link
                href={tosUrl}
                target="_blank"
                rel="noreferrer"
                className="link-brand text-xs font-semibold hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Terms
              </Link>
            ) : null}
            {yracUrl ? (
              <Link
                href={yracUrl}
                target="_blank"
                rel="noreferrer"
                className="link-brand text-xs font-semibold hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                YRAC
              </Link>
            ) : null}

            <span onClick={(e) => e.stopPropagation()}>
              <PlanDisclosuresPopover
                trigger="Disclosures"
                supplierName={offer.supplierName ?? null}
                planName={offer.planName ?? null}
                distributorName={distributorName}
                disclosures={(offer as any)?.disclosures ?? null}
                eflUrl={eflUrl ?? null}
              />
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">500</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh500)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">1000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh1000)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">2000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh2000)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
      </div>

      {statusKind === "NEED_USAGE" && isMissingBuckets ? (
        <div className="mt-3 text-xs text-brand-cyan/70">
          We don’t have enough usable usage history to compute this plan yet.
        </div>
      ) : null}

      {showEstimateLine && estimateMonthly ? (
        <div className="mt-3 text-xs text-brand-cyan/70">
          {typeof repAnnualDollarsRaw === "number" &&
          Number.isFinite(repAnnualDollarsRaw) &&
          typeof totalAnnualDollarsRaw === "number" &&
          Number.isFinite(totalAnnualDollarsRaw) ? (
            <EstimateBreakdownPopover
              trigger={
                <>
                  Est. ${estimateMonthly}/mo
                  {tdspTag ? <span className="text-brand-cyan/60"> · {tdspTag}</span> : null}
                  {usageTag ? <span className="text-brand-cyan/60"> · {usageTag}</span> : null}
                </>
              }
              repAnnualDollars={repAnnualDollarsRaw}
              tdspDeliveryAnnualDollars={
                typeof c2?.tdsp?.deliveryDollars === "number" && Number.isFinite(c2.tdsp.deliveryDollars)
                  ? c2.tdsp.deliveryDollars
                  : undefined
              }
              tdspFixedAnnualDollars={
                typeof c2?.tdsp?.fixedDollars === "number" && Number.isFinite(c2.tdsp.fixedDollars)
                  ? c2.tdsp.fixedDollars
                  : undefined
              }
              totalAnnualDollars={totalAnnualDollarsRaw}
              effectiveDate={tdspEffective ?? undefined}
            />
          ) : (
            <span className="font-semibold text-brand-white/90">
              Est. ${estimateMonthly}/mo
              {tdspTag ? <span className="text-brand-cyan/60"> · {tdspTag}</span> : null}
              {usageTag ? <span className="text-brand-cyan/60"> · {usageTag}</span> : null}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-1 text-xs text-brand-cyan/65 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="truncate">
            {offer.utility?.utilityName ? (
              <span className="truncate">{offer.utility.utilityName}</span>
            ) : offer.utility?.tdspSlug ? (
              <span className="uppercase">{offer.utility.tdspSlug}</span>
            ) : (
              <span>Utility —</span>
            )}
          </span>
          {cancellationFeeText ? (
            <span className="text-brand-cyan/55">
              · Cancellation fee: <span className="text-brand-cyan/75">{cancellationFeeText}</span>
            </span>
          ) : null}
        </div>
        <div className="text-brand-cyan/55">
          EFL averages shown at 500/1000/2000 kWh.
        </div>
      </div>
    </div>
  );
}


