"use client";

const TOOL_CARDS = [
  {
    href: "/admin/tools/hitthejackwatt-ads",
    title: "HitTheJackWatt Social Ads",
    description: "Download SVG creatives and copy suggested captions for the jackpot campaign",
  },
  {
    href: "/admin/tools/prisma-studio",
    title: "Prisma Studio Shortcuts",
    description: "Copy PowerShell blocks to open Prisma Studio on specific databases and ports.",
  },
  {
    href: "/admin/tools/bot-messages",
    title: "IntelliWattBot Messages",
    description: "Edit the IntelliWattBot speech bubble copy per dashboard page.",
  },
  {
    href: "/admin/tools/gapfill-lab",
    title: "Manual GapFill Lab",
    description:
      "Primary admin workflow: SMT source → manual monthly/annual seed → One Path lab Past Sim → compare (MG-1–MG-5).",
  },
  {
    href: "/admin/tools/manual-monthly",
    title: "Manual Monthly Lab",
    description: "Browser-based harness for the customer manual-monthly flow with diagnostics.",
  },
  {
    href: "/admin/tools/validation-day-policy",
    title: "Compare Day Policy",
    description:
      "Shared validation-day selection for Past Sim compare intervals — global policy owner used by Manual GapFill and One Path.",
  },
  {
    href: "/admin/tools/manual-gapfill",
    title: "Manual GapFill API Debug",
    description: "Debug-only MG-1–MG-5 route harness. Primary workflow: Manual GapFill Lab.",
  },
  {
    href: "/admin/tools/model-intelligence-lab",
    title: "Model Intelligence Lab",
    description:
      "Orchestrate One Path masked simulations, compare results using shared diagnostics, analyze cohorts, and manage tuning recommendations.",
  },
  {
    href: "/admin/tools/one-path-sim",
    title: "One Path Sim Admin",
    description: "Canonical admin harness for shared interval, manual, annual, and new-build simulation runs.",
  },
  {
    href: "/admin/tools/green-button-pipeline",
    title: "Green Button Pipeline Check",
    description: "Upload a Green Button file through Droplet ingest against the isolated admin test home.",
  },
  {
    href: "/admin/tools/usage-shape-profile",
    title: "Usage Shape Profile",
    description: "Derive and save usage shape from actual 15-minute intervals.",
  },
  {
    href: "/admin/tools/weather-sensitivity-lab",
    title: "Weather Sensitivity Lab",
    description: "Inspect the shared weather sensitivity score, diagnostics, and score positioning across loaded homes.",
  },
];

export function AdminToolsGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {TOOL_CARDS.map((card) => (
        <a
          key={card.href}
          href={card.href}
          className="block rounded-lg border-2 border-brand-blue/20 p-4 transition-colors hover:border-brand-blue hover:bg-brand-blue/5"
        >
          <div className="mb-1 font-semibold text-brand-navy">{card.title}</div>
          <div className="text-sm text-brand-navy/60">{card.description}</div>
        </a>
      ))}
    </div>
  );
}
