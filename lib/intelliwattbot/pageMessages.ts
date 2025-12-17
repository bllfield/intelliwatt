export type BotPageKey =
  | "dashboard"
  | "dashboard_api"
  | "dashboard_usage"
  | "dashboard_current_rate"
  | "dashboard_current_rate_details"
  | "dashboard_manual_entry"
  | "dashboard_plans"
  | "dashboard_home"
  | "dashboard_appliances"
  | "dashboard_upgrades"
  | "dashboard_analysis"
  | "dashboard_optimal"
  | "dashboard_entries"
  | "dashboard_referrals"
  | "dashboard_profile"
  | "dashboard_smt_confirmation"
  | "unknown";

export type BotPageMeta = {
  key: BotPageKey;
  label: string;
  paths: string[]; // exact path(s) this message applies to
  defaultMessage: string;
};

export const BOT_PAGES: BotPageMeta[] = [
  {
    key: "dashboard",
    label: "Dashboard Home (/dashboard)",
    paths: ["/dashboard"],
    defaultMessage:
      "Hey — I’m IntelliWattBot.\n\nTo get you the most accurate recommendations, please complete these steps in order:\n1) Save your address\n2) Share your usage\n3) Add your current rate (optional, but makes comparisons stronger)\n4) Home details\n5) Appliances\n\nTell me what you’ve completed so far and I’ll guide you to the next step.",
  },
  {
    key: "dashboard_api",
    label: "API Connect (/dashboard/api)",
    paths: ["/dashboard/api", "/dashboard/api/manual", "/dashboard/api/green-button", "/dashboard/api/smt"],
    defaultMessage:
      "Step 2: Share your usage.\n\nConnect Smart Meter Texas (recommended) or Green Button so I can calculate true annual cost from your real intervals.\nOnce it’s connected, go to Plans so I can rank the best options for you.",
  },
  {
    key: "dashboard_usage",
    label: "Usage (/dashboard/usage)",
    paths: ["/dashboard/usage"],
    defaultMessage:
      "Nice — this is your usage view.\n\nIf you don’t see a full last-12-months dataset yet, go to API Connect and finish linking Smart Meter Texas.\nThe more complete your usage, the more accurate my plan ranking becomes.",
  },
  {
    key: "dashboard_current_rate",
    label: "Current Rate (/dashboard/current-rate)",
    paths: ["/dashboard/current-rate"],
    defaultMessage:
      "Optional (but powerful): add your current plan details.\n\nThis lets me show the *difference* between what you pay today vs the best plans for your exact usage.",
  },
  {
    key: "dashboard_current_rate_details",
    label: "Current Rate Details (/dashboard/current-rate-details)",
    paths: ["/dashboard/current-rate-details"],
    defaultMessage:
      "Almost there — add whatever you can about your current plan (rate, fees, term).\nI’ll use it to estimate your current bill and highlight the biggest savings opportunities.",
  },
  {
    key: "dashboard_manual_entry",
    label: "Manual Entry (/dashboard/manual-entry)",
    paths: ["/dashboard/manual-entry"],
    defaultMessage:
      "If you can’t connect usage yet, you can still move forward.\n\nEnter what you know and I’ll keep you on track — but connecting usage later will make recommendations much more accurate.",
  },
  {
    key: "dashboard_plans",
    label: "Plans (/dashboard/plans)",
    paths: ["/dashboard/plans"],
    defaultMessage:
      "This is where I rank plans.\n\nTo make these recommendations truly accurate, connect usage (API Connect) and optionally add your current rate so I can show the savings delta.",
  },
  {
    key: "dashboard_home",
    label: "Home Info (/dashboard/home)",
    paths: ["/dashboard/home"],
    defaultMessage: "I’m working on this for you now.\n\nIn the meantime: make sure your address and usage are connected — that drives the best recommendations.",
  },
  {
    key: "dashboard_appliances",
    label: "Appliances (/dashboard/appliances)",
    paths: ["/dashboard/appliances"],
    defaultMessage: "I’m working on this for you now.\n\nOnce usage is connected, appliances will help me explain *why* your usage looks the way it does.",
  },
  {
    key: "dashboard_upgrades",
    label: "Upgrades (/dashboard/upgrades)",
    paths: ["/dashboard/upgrades"],
    defaultMessage:
      "I’m working on this for you now.\n\nUpgrades will help me recommend actions beyond switching plans. For now, focus on address + usage for best plan ranking.",
  },
  {
    key: "dashboard_analysis",
    label: "Analysis (/dashboard/analysis)",
    paths: ["/dashboard/analysis"],
    defaultMessage: "I’m working on this for you now.\n\nOnce your usage is connected, I’ll highlight the most important trends and what to do next.",
  },
  {
    key: "dashboard_optimal",
    label: "Optimal (/dashboard/optimal)",
    paths: ["/dashboard/optimal"],
    defaultMessage:
      "I’m working on this for you now.\n\nFor now, use Plans. The more complete your usage and current rate info, the better my “optimal” pick will be.",
  },
  {
    key: "dashboard_entries",
    label: "Entries (/dashboard/entries)",
    paths: ["/dashboard/entries"],
    defaultMessage:
      "Want more entries? The fastest path is:\n- Connect usage (Smart Meter Texas)\n- Add your current rate details\n- Complete home + appliances\n\nI’ll point you to whatever step you’re missing.",
  },
  {
    key: "dashboard_referrals",
    label: "Referrals (/dashboard/referrals)",
    paths: ["/dashboard/referrals"],
    defaultMessage:
      "Referrals are a quick way to stack entries.\n\nShare your link — then come back to Plans once your usage is connected so I can rank the best options for you.",
  },
  {
    key: "dashboard_profile",
    label: "Profile (/dashboard/profile)",
    paths: ["/dashboard/profile"],
    defaultMessage:
      "Keep your profile current so I can personalize recommendations and reminders.\n\nNext: make sure your address and usage are connected.",
  },
  {
    key: "dashboard_smt_confirmation",
    label: "SMT Confirmation (/dashboard/smt-confirmation)",
    paths: ["/dashboard/smt-confirmation"],
    defaultMessage:
      "Please finish confirming Smart Meter Texas access.\n\nOnce approved, I can pull your last 12 months usage automatically and rank plans accurately.",
  },
];

export function resolveBotPageKey(pathname: string | null | undefined): BotPageKey {
  const p = typeof pathname === "string" ? pathname.trim() : "";
  if (!p) return "unknown";
  for (const meta of BOT_PAGES) {
    if (meta.paths.some((x) => x === p || (x.endsWith("/") && x.slice(0, -1) === p))) return meta.key;
    // allow exact base match for nested subroutes under known roots
    if (meta.key === "dashboard_api" && p.startsWith("/dashboard/api")) return meta.key;
  }
  if (p.startsWith("/dashboard")) return "dashboard";
  return "unknown";
}

export function defaultBotMessageForKey(key: BotPageKey): string {
  const found = BOT_PAGES.find((p) => p.key === key);
  return (
    found?.defaultMessage ??
    "Hey — I’m IntelliWattBot.\n\nTell me what you’ve completed so far (address, usage, current rate, home info, appliances) and I’ll guide you to the next step."
  );
}


