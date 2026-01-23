import type { BotPageKey } from "./pageMessages";

export type BotEventKey =
  | "loading"
  | "error"
  | "no_data"
  | "action_required"
  | "success"
  | "calculating_best"
  | "templates_pending"
  | "usage_connected"
  | "usage_missing"
  | "needs_smt_confirmation";

export type BotEventMeta = {
  key: BotEventKey;
  label: string;
  description: string;
};

const COMMON: BotEventMeta[] = [
  { key: "loading", label: "Loading", description: "Show while data is being fetched/processed." },
  { key: "error", label: "Error", description: "Show when the page encounters an error." },
  { key: "no_data", label: "No data", description: "Show when the page has no data to display yet." },
  { key: "action_required", label: "Action required", description: "Show when user must complete a step to proceed." },
  { key: "success", label: "Success", description: "Show after a successful user action." },
];

export const BOT_EVENTS_BY_PAGE: Record<BotPageKey, BotEventMeta[]> = {
  dashboard: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show once usage becomes available." },
    { key: "usage_missing", label: "Usage missing", description: "Show when usage isn’t connected yet." },
  ],
  dashboard_api: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show after SMT/Green Button usage is available." },
    { key: "needs_smt_confirmation", label: "Needs SMT confirmation", description: "Show when SMT is pending approval." },
  ],
  dashboard_api_manual: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show after manual usage is uploaded/saved." },
    { key: "usage_missing", label: "Usage missing", description: "Show when no usage dataset exists yet." },
  ],
  dashboard_api_green_button: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show after Green Button usage is available." },
    { key: "usage_missing", label: "Usage missing", description: "Show when no usage dataset exists yet." },
  ],
  dashboard_api_smt: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show after SMT usage is available." },
    { key: "needs_smt_confirmation", label: "Needs SMT confirmation", description: "Show when SMT is pending approval." },
  ],
  dashboard_usage: [
    ...COMMON,
    { key: "usage_connected", label: "Usage connected", description: "Show when usage insights are available." },
    { key: "usage_missing", label: "Usage missing", description: "Show when no usage dataset exists yet." },
  ],
  dashboard_current_rate: [...COMMON],
  dashboard_current_rate_details: [...COMMON],
  dashboard_manual_entry: [...COMMON],
  dashboard_plans: [
    ...COMMON,
    {
      key: "calculating_best",
      label: "Calculating best plan",
      description: "Show while IntelliWatt is ranking plans using true-cost estimates.",
    },
    {
      key: "templates_pending",
      label: "Templates pending",
      description: "Show while offers are still QUEUED (templates still being prepared).",
    },
    { key: "usage_missing", label: "Usage missing", description: "Show when best-for-you ranking can’t run (no usage)." },
  ],
  dashboard_home: [...COMMON],
  dashboard_appliances: [...COMMON],
  dashboard_upgrades: [...COMMON],
  dashboard_analysis: [...COMMON],
  dashboard_optimal: [...COMMON],
  dashboard_entries: [...COMMON],
  dashboard_referrals: [...COMMON],
  dashboard_profile: [...COMMON],
  dashboard_smt_confirmation: [...COMMON, { key: "needs_smt_confirmation", label: "Needs SMT confirmation", description: "Show while SMT is pending." }],
  unknown: [...COMMON],
};

export function eventsForPageKey(pageKey: string | null | undefined): BotEventMeta[] {
  const k = (pageKey ?? "unknown") as BotPageKey;
  return BOT_EVENTS_BY_PAGE[k] ?? BOT_EVENTS_BY_PAGE.unknown;
}


