export type DashboardFlowStep = {
  key: "usage_entry" | "usage_view" | "usage_simulator" | "plans" | "current_plan" | "compare";
  href: string;
  label: string;
  shortLabel?: string;
};

/**
 * Customer dashboard onboarding flow (in order).
 *
 * This is intentionally the single source of truth for the primary "plan flow" ordering so:
 * - header nav
 * - dashboard home cards
 * - bot guidance copy (high-level)
 *
 * stay consistent.
 */
export const DASHBOARD_FLOW_STEPS: DashboardFlowStep[] = [
  { key: "usage_entry", href: "/dashboard/api", label: "Usage Entry" },
  { key: "usage_view", href: "/dashboard/usage", label: "Usage" },
  { key: "usage_simulator", href: "/dashboard/usage/simulated", label: "Simulated Usage" },
  { key: "plans", href: "/dashboard/plans", label: "Plans" },
  { key: "current_plan", href: "/dashboard/current-rate", label: "Current Plan (optional)", shortLabel: "Current Plan" },
  { key: "compare", href: "/dashboard/plans/compare", label: "Compare" },
];

