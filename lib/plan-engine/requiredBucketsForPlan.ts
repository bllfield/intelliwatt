export type SupportedPlanFeaturesLike = {
  supportsTouEnergy: boolean;
};

export type UsageBucketRequirement = {
  key: string; // canonical bucket key
  description: string;
  optional?: boolean;
};

export function requiredBucketsForPlan(input: {
  features: SupportedPlanFeaturesLike;
}): UsageBucketRequirement[] {
  const out: UsageBucketRequirement[] = [];

  // Always require the total monthly kWh bucket (ALL day, all hours).
  out.push({
    key: "kwh.m.ALL.0000-2400",
    description: "Total monthly kWh (all days, 00:00-24:00)",
  });

  // If/when we support TOU energy, require at least the CORE day/night buckets.
  if (input.features.supportsTouEnergy) {
    out.push({
      key: "kwh.m.ALL.2000-0700",
      description: "Night kWh (all days, 20:00-07:00)",
    });
    out.push({
      key: "kwh.m.ALL.0700-2000",
      description: "Day kWh (all days, 07:00-20:00)",
    });

    // Optional (future): weekday/weekend splits for TOU plans that depend on them.
    out.push({
      key: "kwh.m.WEEKDAY.2000-0700",
      description: "Night kWh (weekdays, 20:00-07:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.WEEKEND.2000-0700",
      description: "Night kWh (weekends, 20:00-07:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.WEEKDAY.0700-2000",
      description: "Day kWh (weekdays, 07:00-20:00)",
      optional: true,
    });
    out.push({
      key: "kwh.m.WEEKEND.0700-2000",
      description: "Day kWh (weekends, 07:00-20:00)",
      optional: true,
    });
  }

  return out;
}


