import type { ValidationDaySelectionMode } from "@/modules/usageSimulator/validationSelection";

export type ValidationDaySelectionModeCatalogEntry = {
  mode: ValidationDaySelectionMode;
  title: string;
  summary: string;
  howItSelects: string;
  bestFor: string;
};

export const VALIDATION_DAY_SELECTION_MODE_CATALOG: ValidationDaySelectionModeCatalogEntry[] = [
  {
    mode: "stratified_weather_balanced",
    title: "Stratified weather balanced",
    summary: "Canonical default — season, weekday/weekend, and weather-bucket spread.",
    howItSelects:
      "Round-robin across winter/summer/shoulder and weekday/weekend buckets using shared selectValidationDayKeys. " +
      "Falls back with explicit diagnostics when a bucket runs short.",
    bestFor: "Production Past Sim, One Path, Manual GapFill, and interval compare surfaces.",
  },
  {
    mode: "customer_style_seasonal_mix",
    title: "Customer style seasonal mix",
    summary: "Random sample with month and weekday/weekend stratification.",
    howItSelects:
      "Seeded random picks grouped by calendar month and weekday vs weekend. Less strict bucket balancing than stratified_weather_balanced.",
    bestFor: "Broader seasonal spread experiments when admin loosens the global policy.",
  },
  {
    mode: "random_simple",
    title: "Random simple",
    summary: "Uniform random sample from clean candidate days.",
    howItSelects: "Seeded shuffle of candidate days without month or weekend stratification.",
    bestFor: "Quick spot checks only — not the production default.",
  },
  {
    mode: "manual",
    title: "Manual explicit keys",
    summary: "Uses only explicitly supplied date keys (not used by global auto-pick).",
    howItSelects:
      "Honored when a caller passes validationOnlyDateKeysLocal. Global policy auto-pick paths use the modes above instead.",
    bestFor: "Legacy explicit-key callers; global admin policy should use an auto mode.",
  },
];

export const VALIDATION_DAY_POLICY_GUARDRAILS = [
  {
    id: "canonical_window",
    title: "Canonical 365-day coverage window",
    detail:
      "Candidate and selected compare days are bounded to resolveCanonicalUsage365CoverageWindow() (America/Chicago, lag-aware). " +
      "Keys outside the window are dropped before Past Sim dispatch.",
  },
  {
    id: "travel_exclusion",
    title: "Travel / vacant exclusion",
    detail:
      "Travel ranges from the latest usageSimulatorBuild inputs exclude candidate days before selection.",
  },
  {
    id: "shared_selector",
    title: "Single selector owner",
    detail:
      "All wired surfaces call lib/usage/validationDayPolicy.ts → selectValidationDayKeys. GapFill Lab local selectors are retired on compare paths.",
  },
  {
    id: "actual_candidates",
    title: "Actual-usage candidates",
    detail:
      "When daily actual usage exists for the house, candidates come from those dates inside the window; otherwise calendar days in the window are used.",
  },
  {
    id: "policy_precedence",
    title: "Policy precedence",
    detail:
      "Deploy env VALIDATION_DAY_POLICY_OVERRIDE_JSON wins over admin-saved policy; admin-saved policy wins over code defaults. Preview-with-draft is admin-only and does not persist.",
  },
  {
    id: "admin_email_lookup",
    title: "Admin home lookup by email",
    detail:
      "Admin tools resolve houses via user email (/api/admin/houses/by-email). Do not require operators to paste houseId or userId for preview.",
  },
] as const;

export const VALIDATION_DAY_POLICY_WIRED_SURFACES = [
  "One Path admin runs (INTERVAL / GREEN_BUTTON / manual modes)",
  "Manual GapFill MG-4 Past Sim readback",
  "Manual GapFill MG-5 compare diagnostics",
  "GapFill Lab compare / validation-day selection (non source-copy parity)",
  "User-site Past Sim recalc when validation is reconciled",
] as const;
