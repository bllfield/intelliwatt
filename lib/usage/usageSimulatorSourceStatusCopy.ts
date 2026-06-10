import { buildManualBillPeriodTargets } from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export type UsageSimulatorActiveSourceKind = "MANUAL_TOTALS" | "ACTUAL_INTERVALS" | "NONE";

export type UsageSimulatorSourceStatusCopy = {
  kind: UsageSimulatorActiveSourceKind;
  connectedBadge: string | null;
  stepSummary: string;
  coverageLabel: string;
  coverageLine: string;
  secondaryStatus: string | null;
};

function formatUsDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;
  return `${month}/${day}/${year}`;
}

function formatKwhWhole(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} kWh`;
}

export function resolveManualStatementSummary(
  payload: ManualUsagePayload | null | undefined
): { startDate: string; endDate: string; statementCount: number; totalKwh: number } | null {
  if (!payload) return null;
  const targets = buildManualBillPeriodTargets(payload);
  if (!targets.length) return null;
  const sorted = [...targets].sort((left, right) => left.startDate.localeCompare(right.startDate));
  const totalKwh = targets.reduce((sum, target) => {
    const entered = target.enteredKwh;
    return sum + (Number.isFinite(Number(entered)) ? Number(entered) : 0);
  }, 0);
  return {
    startDate: sorted[0]!.startDate,
    endDate: sorted[sorted.length - 1]!.endDate,
    statementCount: targets.length,
    totalKwh,
  };
}

export function isManualTotalsActiveUsageSource(args: {
  mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
  normalizedIntent?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
}): boolean {
  if (args.normalizedIntent === "MANUAL") return true;
  if (args.mode !== "MANUAL_TOTALS") return false;
  return Boolean(args.manualUsagePayload);
}

export function resolveUsageSimulatorActiveSourceKind(args: {
  mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
  normalizedIntent?: string | null;
  hasActualIntervals: boolean;
  manualUsagePayload?: ManualUsagePayload | null;
}): UsageSimulatorActiveSourceKind {
  if (isManualTotalsActiveUsageSource(args)) return "MANUAL_TOTALS";
  if (args.hasActualIntervals) return "ACTUAL_INTERVALS";
  return "NONE";
}

export function resolveUsageSimulatorSourceStatusCopy(args: {
  mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
  normalizedIntent?: string | null;
  hasActualIntervals: boolean;
  manualUsagePayload?: ManualUsagePayload | null;
  actualSource?: string | null;
  actualCoverage?: { start: string | null; end: string | null; intervalsCount: number } | null;
  pastSimAvailable?: boolean;
}): UsageSimulatorSourceStatusCopy {
  const kind = resolveUsageSimulatorActiveSourceKind(args);

  if (kind === "MANUAL_TOTALS") {
    const statement = resolveManualStatementSummary(args.manualUsagePayload);
    const coverageLine = statement
      ? `${formatUsDate(statement.startDate)} → ${formatUsDate(statement.endDate)} · ${statement.statementCount} statements · ${formatKwhWhole(statement.totalKwh)}`
      : "saved monthly statement totals (bill-period based).";
    const secondaryParts: string[] = [];
    if (!args.hasActualIntervals) {
      secondaryParts.push("Actual interval data: not connected");
    }
    if (args.pastSimAvailable) {
      secondaryParts.push("Past simulated usage is available from the manual bill totals");
    }
    return {
      kind,
      connectedBadge: "Manual totals saved",
      stepSummary:
        "Your Usage is Manual totals (bill-period based). Complete the required details below to unlock Past/Future simulations.",
      coverageLabel: "Manual bills:",
      coverageLine,
      secondaryStatus: secondaryParts.length ? secondaryParts.join(" · ") : null,
    };
  }

  if (kind === "ACTUAL_INTERVALS") {
    const source = args.actualSource ?? "ACTUAL";
    const start = args.actualCoverage?.start ?? "?";
    const end = args.actualCoverage?.end ?? "?";
    const intervalsCount = args.actualCoverage?.intervalsCount ?? 0;
    return {
      kind,
      connectedBadge: "Actual connected",
      stepSummary:
        "Your Usage is Actual usage (read-only). Complete the required details below to unlock Past/Future simulations.",
      coverageLabel: "Actual coverage:",
      coverageLine: `${source} · ${start} → ${end} · ${intervalsCount} intervals`,
      secondaryStatus: null,
    };
  }

  return {
    kind,
    connectedBadge: null,
    stepSummary:
      "No interval usage connected yet. Complete Home + Appliances, then use Past/Future workspaces to simulate.",
    coverageLabel: "Actual coverage:",
    coverageLine: "none",
    secondaryStatus: "Actual interval data: not connected",
  };
}
