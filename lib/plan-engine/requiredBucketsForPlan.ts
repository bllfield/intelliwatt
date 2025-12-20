export type SupportedPlanFeaturesLike = {
  supportsTouEnergy: boolean;
  supportsWeekendSplitEnergy?: boolean;
};

export type UsageBucketRequirement = {
  key: string; // canonical bucket key
  description: string;
  optional?: boolean;
};

import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { extractDeterministicTierSchedule } from "@/lib/plan-engine/tieredPricing";

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function keyForPeriod(p: { dayType: "all" | "weekday" | "weekend"; startHHMM: string; endHHMM: string }): string {
  const day = p.dayType;
  const start = String(p.startHHMM ?? "").trim();
  const end = String(p.endHHMM ?? "").trim();
  if (start === "0000" && end === "2400") return `kwh.m.${day}.total`;
  return `kwh.m.${day}.${start}-${end}`;
}

export function requiredBucketsForRateStructure(args: { rateStructure: any }): UsageBucketRequirement[] {
  const out: UsageBucketRequirement[] = [];

  out.push({
    key: "kwh.m.all.total",
    description: "Total monthly kWh (all days, 00:00-24:00)",
  });

  // Tiered pricing needs only monthly total kWh.
  // (Combined TOU+tier is not supported; this is a safe early return when tiers are present.)
  const tiered = extractDeterministicTierSchedule(args.rateStructure);
  if (tiered.ok) return out;

  const extracted = extractDeterministicTouSchedule(args.rateStructure);
  if (!extracted.schedule) return out;

  const periodKeys = uniq(extracted.schedule.periods.map((p) => keyForPeriod(p)));
  for (const k of periodKeys) {
    if (k === "kwh.m.all.total") continue;
    out.push({
      key: k,
      description: `TOU window bucket: ${k}`,
    });
  }

  return out;
}

export function requiredBucketsForPlan(input: {
  features: SupportedPlanFeaturesLike;
}): UsageBucketRequirement[] {
  const out: UsageBucketRequirement[] = [];

  // Always require the total monthly kWh bucket (ALL day, all hours).
  out.push({
    key: "kwh.m.all.total",
    description: "Total monthly kWh (all days, 00:00-24:00)",
  });

  // TODO(v2): requiredBucketKeys must be derived from template schedules/windows (rateStructure),
  // not from feature flags. This file is a temporary, conservative placeholder.

  // If/when we support TOU energy, require at least the CORE day/night buckets.
  if (input.features.supportsTouEnergy) {
    out.push({
      key: "kwh.m.all.2000-0700",
      description: "Night kWh (all days, 20:00-07:00)",
    });
    out.push({
      key: "kwh.m.all.0700-2000",
      description: "Day kWh (all days, 07:00-20:00)",
    });

    // Optional (future): weekday/weekend splits for TOU plans that depend on them.
    out.push({
      key: "kwh.m.weekday.2000-0700",
      description: "Night kWh (weekdays, 20:00-07:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.weekend.2000-0700",
      description: "Night kWh (weekends, 20:00-07:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.weekday.0700-2000",
      description: "Day kWh (weekdays, 07:00-20:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.weekend.0700-2000",
      description: "Day kWh (weekends, 07:00-20:00)",
      optional: true,
    });
  }

  // Phase: Free Weekends (weekday vs weekend all-day), bucket-gated.
  // IMPORTANT: canonical "all-day" buckets use `.total` (not `.0000-2400`).
  if (input.features.supportsWeekendSplitEnergy) {
    out.push({
      key: "kwh.m.weekday.total",
      description: "Total monthly kWh (weekdays, 00:00-24:00)",
    });
    out.push({
      key: "kwh.m.weekend.total",
      description: "Total monthly kWh (weekends, 00:00-24:00)",
    });
  }

  return out;
}


