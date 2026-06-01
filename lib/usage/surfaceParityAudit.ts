import "server-only";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { normalizeEmail } from "@/lib/utils/email";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import {
  resolveHouseCommittedUsageSource,
  houseHasUsableGreenButton,
} from "@/lib/usage/houseCommittedUsageSource";
import { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";
import { buildOnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import { filterUserVisibleHouses } from "@/lib/usage/userSiteSimulationIsolation";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

export type SurfaceParityRowStatus = "match" | "mismatch" | "skipped" | "blocked";

export type SurfaceParityRow = {
  surface: "usage" | "baseline" | "past_sim";
  userPath: string;
  onePathPath: string;
  status: SurfaceParityRowStatus;
  summary: string;
  details?: Record<string, unknown>;
};

export type SurfaceParityAuditResult = {
  ok: boolean;
  email: string;
  userId: string;
  houseId: string;
  houseLabel: string;
  committedSource: "SMT" | "GREEN_BUTTON" | null;
  greenButtonIntervalCount: number | null;
  rows: SurfaceParityRow[];
  baselineParityReport: ReturnType<typeof buildBaselineParityReport> | null;
  baselineParityAudit: ReturnType<typeof buildOnePathBaselineParityAudit> | null;
  error?: string;
};

function contractFingerprint(contract: Awaited<ReturnType<typeof buildUserUsageHouseContract>> | null) {
  const dataset = contract?.dataset as { summary?: Record<string, unknown>; meta?: Record<string, unknown> } | null;
  const summary = dataset?.summary ?? {};
  const meta = dataset?.meta ?? {};
  return {
    source: String(summary.source ?? meta.actualSource ?? ""),
    coverageStart: String(meta.coverageStart ?? summary.start ?? ""),
    coverageEnd: String(meta.coverageEnd ?? summary.end ?? ""),
    intervalsCount: Number(summary.intervalsCount ?? 0) || 0,
    totalKwh: Number(summary.totalKwh ?? 0) || 0,
  };
}

async function countGreenButtonIntervals(houseId: string): Promise<number | null> {
  if (!USAGE_DB_ENABLED) return null;
  try {
    return await (usagePrisma as any).greenButtonInterval.count({ where: { homeId: houseId } });
  } catch {
    return null;
  }
}

export async function runSurfaceParityAuditForEmail(args: {
  email: string;
  houseId?: string | null;
}): Promise<SurfaceParityAuditResult> {
  const email = normalizeEmail(String(args.email ?? "").trim());
  if (!email) {
    return {
      ok: false,
      email: "",
      userId: "",
      houseId: "",
      houseLabel: "",
      committedSource: null,
      greenButtonIntervalCount: null,
      rows: [],
      baselineParityReport: null,
      baselineParityAudit: null,
      error: "email_required",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) {
    return {
      ok: false,
      email,
      userId: "",
      houseId: "",
      houseLabel: "",
      committedSource: null,
      greenButtonIntervalCount: null,
      rows: [],
      baselineParityReport: null,
      baselineParityAudit: null,
      error: "user_not_found",
    };
  }

  const houses = filterUserVisibleHouses(
    await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
        isPrimary: true,
      },
    })
  );
  if (!houses.length) {
    return {
      ok: false,
      email: user.email,
      userId: user.id,
      houseId: "",
      houseLabel: "",
      committedSource: null,
      greenButtonIntervalCount: null,
      rows: [],
      baselineParityReport: null,
      baselineParityAudit: null,
      error: "no_visible_houses",
    };
  }

  const requestedHouseId = String(args.houseId ?? "").trim();
  const house =
    (requestedHouseId ? houses.find((row) => row.id === requestedHouseId) : null) ?? houses[0]!;

  const committedSource = await resolveHouseCommittedUsageSource({
    userId: user.id,
    houseId: house.id,
    esiid: house.esiid ?? null,
  });
  const gbCount = await countGreenButtonIntervals(house.id);
  const gbReady = await houseHasUsableGreenButton(house.id).catch(() => false);

  const houseForContract = {
    id: house.id,
    label: house.label ?? null,
    addressLine1: house.addressLine1 ?? null,
    addressCity: house.addressCity ?? null,
    addressState: house.addressState ?? null,
    esiid: house.esiid ?? null,
  };

  const sharedResolveOpts = {
    userId: user.id,
    houseId: house.id,
    layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
    esiid: house.esiid ?? null,
    userUsageDashboardLoad: true as const,
    skipLightweightInsightRecompute: true as const,
  };

  const userSiteResolved = await resolveIntervalsLayer(sharedResolveOpts).catch(() => null);
  const userSiteContract = await buildUserUsageHouseContract({
    userId: user.id,
    house: houseForContract,
    resolvedUsage: userSiteResolved,
    lightweightActualUsage: true,
    skipLightweightInsightRecompute: true,
  }).catch(() => null);

  const onePathResolved = await resolveIntervalsLayer(sharedResolveOpts).catch(() => null);
  const onePathContract = await buildUserUsageHouseContract({
    userId: user.id,
    house: houseForContract,
    resolvedUsage: onePathResolved,
    lightweightActualUsage: true,
    skipLightweightInsightRecompute: true,
  }).catch(() => null);

  const userFp = contractFingerprint(userSiteContract);
  const onePathFp = contractFingerprint(onePathContract);
  const usageMatch =
    userSiteContract?.dataset != null &&
    onePathContract?.dataset != null &&
    userFp.source === onePathFp.source &&
    userFp.coverageStart === onePathFp.coverageStart &&
    userFp.coverageEnd === onePathFp.coverageEnd &&
    userFp.intervalsCount === onePathFp.intervalsCount &&
    Math.abs(userFp.totalKwh - onePathFp.totalKwh) < 0.05;

  const baselineParityReport = buildBaselineParityReport({
    userUsagePageContract: userSiteContract,
    onePathBaselineContract: onePathContract,
  });
  const baselineParityAudit = buildOnePathBaselineParityAudit({
    houseContract: onePathContract,
  });

  const pastScenario = await prisma.usageSimulatorScenario.findFirst({
    where: {
      userId: user.id,
      houseId: house.id,
      name: { contains: "Past", mode: "insensitive" },
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });

  const rows: SurfaceParityRow[] = [
    {
      surface: "usage",
      userPath: "/api/user/usage → buildUserUsageHouseContract",
      onePathPath: "resolveIntervalsLayer (committed) → buildUserUsageHouseContract",
      status: usageMatch ? "match" : userSiteContract?.dataset == null || onePathContract?.dataset == null ? "blocked" : "mismatch",
      summary: usageMatch
        ? "Usage contracts match (source, window, counts, total kWh)."
        : userSiteContract?.dataset == null || onePathContract?.dataset == null
          ? "One or both usage datasets are empty."
          : "Usage contract fingerprint mismatch.",
      details: { user: userFp, onePath: onePathFp, committedSource, gbReady, greenButtonIntervalCount: gbCount },
    },
    {
      surface: "baseline",
      userPath: "/api/user/usage/simulated/house (baseline alias)",
      onePathPath: "Same buildUserUsageHouseContract as Usage",
      status: baselineParityReport.overallMatch ? "match" : "mismatch",
      summary: baselineParityReport.overallMatch
        ? "Baseline parity report overall match."
        : `Baseline divergence: ${baselineParityReport.firstDivergenceField ?? "unknown"}`,
      details: {
        matchedKeys: baselineParityReport.matchedKeys,
        mismatchedKeys: baselineParityReport.mismatchedKeys,
        parityStatus: baselineParityAudit.parityStatus,
      },
    },
    {
      surface: "past_sim",
      userPath: "modules/usageSimulator/service.ts (user_past)",
      onePathPath: "modules/onePathSim/usageSimulator/service.ts (admin)",
      status: pastScenario ? "skipped" : "blocked",
      summary: pastScenario
        ? `Past scenario found (${pastScenario.name}). Run One Path + user Past recalc to compare artifacts; not auto-run here.`
        : "No Past scenario on this house. Create workspace scenarios or run One Path lookup first.",
      details: pastScenario
        ? { scenarioId: pastScenario.id, scenarioName: pastScenario.name, updatedAt: pastScenario.updatedAt }
        : { committedSource, hint: "Use One Path harness with generic preset Green Button · Past Sim after data is present." },
    },
  ];

  const overallOk = rows.every((row) => row.status === "match" || row.status === "skipped");

  return {
    ok: overallOk,
    email: user.email,
    userId: user.id,
    houseId: house.id,
    houseLabel: toPublicHouseLabel({
      label: house.label,
      addressLine1: house.addressLine1,
      fallbackId: house.id,
    }),
    committedSource,
    greenButtonIntervalCount: gbCount,
    rows,
    baselineParityReport,
    baselineParityAudit,
  };
}
