import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { monthsEndingAt, lastFullMonthChicago } from "@/modules/manualUsage/anchor";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { buildSimulatorInputs, type BaseKind, type BuildMode } from "@/modules/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/usageSimulator/requirements";
import { hasSmtIntervals, SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { buildSimulatedUsageDatasetFromBuildInputs, type SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { computeBuildInputsHash } from "@/modules/usageSimulator/hash";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/simulatedUsage/intradayTemplates";
import { computeMonthlyOverlay } from "@/modules/usageScenario/overlay";
import { normalizeScenarioKey } from "@/modules/usageSimulator/repo";

type ManualUsagePayloadAny = any;

function canonicalMonthsForRecalc(args: { mode: SimulatorMode; manualUsagePayload: ManualUsagePayloadAny | null; now?: Date }) {
  const now = args.now ?? new Date();

  // V1 determinism: derive canonicalMonths from manual anchor when in manual mode, else platform default (last full month Chicago).
  if (args.mode === "MANUAL_TOTALS" && args.manualUsagePayload) {
    const p = args.manualUsagePayload as any;
    if (p?.mode === "MONTHLY" && typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth)) {
      const endMonth = String(p.anchorEndMonth);
      return { endMonth, months: monthsEndingAt(endMonth, 12) };
    }
    if (p?.mode === "ANNUAL" && typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)) {
      const endMonth = String(p.endDate).slice(0, 7);
      return { endMonth, months: monthsEndingAt(endMonth, 12) };
    }
  }

  const endMonth = lastFullMonthChicago(now);
  return { endMonth, months: monthsEndingAt(endMonth, 12) };
}

function baseKindFromMode(mode: SimulatorMode): BaseKind {
  if (mode === "MANUAL_TOTALS") return "MANUAL";
  if (mode === "NEW_BUILD_ESTIMATE") return "ESTIMATED";
  return "SMT_ACTUAL_BASELINE";
}

export type SimulatorRecalcOk = {
  ok: true;
  houseId: string;
  buildInputsHash: string;
  dataset: any;
};

export type SimulatorRecalcErr = {
  ok: false;
  error: string;
  missingItems?: string[];
};

export async function recalcSimulatorBuild(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  now?: Date;
}): Promise<SimulatorRecalcOk | SimulatorRecalcErr> {
  const { userId, houseId, esiid, mode } = args;
  const scenarioKey = normalizeScenarioKey(args.scenarioId);
  const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;

  // Load persisted baseline inputs
  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { payload: true } })
      .catch(() => null),
    (homeDetailsPrisma as any).homeProfileSimulated.findUnique({ where: { userId_houseId: { userId, houseId } } }).catch(() => null),
    (appliancesPrisma as any).applianceProfileSimulated
      .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { appliancesJson: true } })
      .catch(() => null),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec
    ? {
        homeAge: homeRec.homeAge,
        homeStyle: homeRec.homeStyle,
        squareFeet: homeRec.squareFeet,
        stories: homeRec.stories,
        insulationType: homeRec.insulationType,
        windowType: homeRec.windowType,
        foundation: homeRec.foundation,
        ledLights: homeRec.ledLights,
        smartThermostat: homeRec.smartThermostat,
        summerTemp: homeRec.summerTemp,
        winterTemp: homeRec.winterTemp,
        occupantsWork: homeRec.occupantsWork,
        occupantsSchool: homeRec.occupantsSchool,
        occupantsHomeAllDay: homeRec.occupantsHomeAllDay,
        fuelConfiguration: homeRec.fuelConfiguration,
      }
    : null;

  const smtOk = esiid ? await hasSmtIntervals({ esiid, canonicalMonths: canonical.months }) : false;

  // Baseline ladder enforcement (V1): SMT_BASELINE requires SMT 15-minute intervals.
  if (mode === "SMT_BASELINE" && !smtOk) {
    return { ok: false, error: "requirements_unmet", missingItems: ["SMT 15-minute interval data required"] };
  }

  // Scenario must exist (and be house-scoped) when scenarioId is provided.
  let scenario: { id: string; name: string } | null = null;
  let scenarioEvents: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: any }> = [];
  if (scenarioId) {
    scenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: { id: scenarioId, userId, houseId, archivedAt: null },
        select: { id: true, name: true },
      })
      .catch(() => null);
    if (!scenario) return { ok: false, error: "scenario_not_found" };

    scenarioEvents = await (prisma as any).usageSimulatorScenarioEvent
      .findMany({
        where: { scenarioId: scenarioId },
        select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
        orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
      .catch(() => []);
  }

  // NEW_BUILD_ESTIMATE completeness enforcement uses existing validators via requirements.
  const req = computeRequirements(
    {
      manualUsagePayload: manualUsagePayload as any,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      hasSmtIntervals: smtOk,
    },
    mode,
  );
  if (!req.canRecalc) return { ok: false, error: "requirements_unmet", missingItems: req.missingItems };

  if (!homeProfile) return { ok: false, error: "homeProfile_required" };
  if (!applianceProfile?.fuelConfiguration) return { ok: false, error: "applianceProfile_required" };

  // Enforce mode->baseKind mapping (no mismatches)
  const baseKind = baseKindFromMode(mode);

  const built = await buildSimulatorInputs({
    mode: mode as BuildMode,
    manualUsagePayload: manualUsagePayload as any,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    esiidForSmt: esiid,
    baselineHomeProfile: homeProfile,
    baselineApplianceProfile: applianceProfile,
    canonicalMonths: canonical.months,
    now: args.now,
  });

  // Safety: built.baseKind must match mode mapping in V1
  if (built.baseKind !== baseKind) {
    return { ok: false, error: "baseKind_mismatch" };
  }

  const overlay = scenarioId
    ? computeMonthlyOverlay({
        canonicalMonths: built.canonicalMonths,
        events: scenarioEvents as any,
      })
    : null;

  const monthlyTotalsKwhByMonth: Record<string, number> = {};
  for (let i = 0; i < built.canonicalMonths.length; i++) {
    const ym = built.canonicalMonths[i];
    const base = Number(built.monthlyTotalsKwhByMonth?.[ym] ?? 0) || 0;
    if (!overlay) {
      monthlyTotalsKwhByMonth[ym] = Math.max(0, base);
      continue;
    }
    const multRaw = overlay.monthlyMultipliersByMonth?.[ym];
    const multNum = multRaw == null ? NaN : Number(multRaw);
    const mult = Number.isFinite(multNum) ? multNum : 1;

    const addRaw = overlay.monthlyAddersKwhByMonth?.[ym];
    const addNum = addRaw == null ? NaN : Number(addRaw);
    const add = Number.isFinite(addNum) ? addNum : 0;
    monthlyTotalsKwhByMonth[ym] = Math.max(0, base * mult + add);
  }

  const notes = [...(built.notes ?? [])];
  if (scenarioId) {
    notes.push(`Scenario applied: ${scenario?.name ?? scenarioId}`);
    if ((overlay?.inactiveEventIds?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.inactiveEventIds.length} inactive event(s).`);
    if ((overlay?.warnings?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.warnings.length} warning(s).`);
  }

  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
  };

  const buildInputs: SimulatorBuildInputsV1 & {
    scenarioKey?: string;
    scenarioId?: string | null;
    versions?: typeof versions;
  } = {
    version: 1,
    mode,
    baseKind,
    canonicalEndMonth: canonical.endMonth,
    canonicalMonths: built.canonicalMonths,
    monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges: mode === "MANUAL_TOTALS" ? (manualUsagePayload?.travelRanges ?? []) : [],
    notes,
    filledMonths: built.filledMonths,
    snapshots: {
      manualUsagePayload: manualUsagePayload ?? null,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      smtMonthlyAnchorsByMonth: built.source?.smtMonthlyAnchorsByMonth ?? undefined,
      smtIntradayShape96: built.source?.smtIntradayShape96 ?? undefined,
      scenario: scenario ? { id: scenario.id, name: scenario.name } : null,
      scenarioEvents: scenarioEvents ?? [],
      scenarioOverlay: overlay ?? null,
    },
    scenarioKey,
    scenarioId,
    versions,
  };

  // V1 hash: stable JSON of a deterministic object.
  const eventsForHash = (scenarioEvents ?? [])
    .map((e) => {
      const p = (e as any)?.payloadJson ?? {};
      const multiplier = typeof p?.multiplier === "number" && Number.isFinite(p.multiplier) ? p.multiplier : null;
      const adderKwh = typeof p?.adderKwh === "number" && Number.isFinite(p.adderKwh) ? p.adderKwh : null;
      return {
        id: String(e?.id ?? ""),
        effectiveMonth: String(e?.effectiveMonth ?? ""),
        kind: String(e?.kind ?? ""),
        multiplier,
        adderKwh,
      };
    })
    .sort((a, b) => {
      if (a.effectiveMonth !== b.effectiveMonth) return a.effectiveMonth < b.effectiveMonth ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const buildInputsHash = computeBuildInputsHash({
    canonicalMonths: buildInputs.canonicalMonths,
    mode: buildInputs.mode,
    baseKind: buildInputs.baseKind,
    scenarioKey,
    scenarioEvents: eventsForHash,
    versions,
  });

  const dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
  dataset.meta = {
    ...(dataset.meta ?? {}),
    buildInputsHash,
    lastBuiltAt: new Date().toISOString(),
    scenarioKey,
    scenarioId,
  };

  await (prisma as any).usageSimulatorBuild.upsert({
    where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey } },
    create: {
      userId,
      houseId,
      scenarioKey,
      mode,
      baseKind,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      canonicalMonthsJson: buildInputs.canonicalMonths,
      buildInputs,
      buildInputsHash,
      estimatorVersion: versions.estimatorVersion,
      reshapeCoeffVersion: versions.reshapeCoeffVersion,
      intradayTemplateVersion: versions.intradayTemplateVersion,
      smtShapeDerivationVersion: versions.smtShapeDerivationVersion,
      lastBuiltAt: new Date(),
    },
    update: {
      mode,
      baseKind,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      canonicalMonthsJson: buildInputs.canonicalMonths,
      buildInputs,
      buildInputsHash,
      estimatorVersion: versions.estimatorVersion,
      reshapeCoeffVersion: versions.reshapeCoeffVersion,
      intradayTemplateVersion: versions.intradayTemplateVersion,
      smtShapeDerivationVersion: versions.smtShapeDerivationVersion,
      lastBuiltAt: new Date(),
    },
  });

  return { ok: true, houseId, buildInputsHash, dataset };
}

export type SimulatedUsageHouseRow = {
  houseId: string;
  label: string | null;
  address: { line1: string; city: string | null; state: string | null };
  esiid: string | null;
  dataset: any | null;
  alternatives: { smt: null; greenButton: null };
};

export async function getSimulatedUsageForUser(args: {
  userId: string;
}): Promise<{ ok: true; houses: SimulatedUsageHouseRow[] } | { ok: false; error: string }> {
  try {
    const houses = await prisma.houseAddress.findMany({
      where: { userId: args.userId, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
      },
    });

    const results: SimulatedUsageHouseRow[] = [];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: h.id, scenarioKey: "BASELINE" } },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
        })
        .catch(() => null);

      let dataset: any | null = null;
      if (buildRec?.buildInputs) {
        try {
          const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
          dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
          dataset.meta = {
            ...(dataset.meta ?? {}),
            buildInputsHash: String(buildRec.buildInputsHash ?? ""),
            lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
          };
        } catch {
          dataset = null;
        }
      }

      results.push({
        houseId: h.id,
        label: h.label || h.addressLine1,
        address: { line1: h.addressLine1, city: h.addressCity, state: h.addressState },
        esiid: h.esiid,
        dataset,
        alternatives: { smt: null, greenButton: null },
      });
    }

    return { ok: true, houses: results };
  } catch (e) {
    console.error("[usageSimulator/service] getSimulatedUsageForUser failed", e);
    return { ok: false, error: "Internal error" };
  }
}

export async function getSimulatedUsageForHouseScenario(args: {
  userId: string;
  houseId: string;
  scenarioId?: string | null;
}): Promise<
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | { ok: false; code: "NO_BUILD" | "SCENARIO_NOT_FOUND" | "HOUSE_NOT_FOUND" | "INTERNAL_ERROR"; message: string }
> {
  try {
    const scenarioKey = normalizeScenarioKey(args.scenarioId);
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;

    const house = await prisma.houseAddress.findFirst({
      where: { id: args.houseId, userId: args.userId, archivedAt: null },
      select: { id: true },
    });
    if (!house) return { ok: false, code: "HOUSE_NOT_FOUND", message: "House not found for user" };

    if (scenarioId) {
      const scenario = await (prisma as any).usageSimulatorScenario
        .findFirst({ where: { id: scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
        .catch(() => null);
      if (!scenario) return { ok: false, code: "SCENARIO_NOT_FOUND", message: "Scenario not found for user/house" };
    }

    const buildRec = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
        select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
      })
      .catch(() => null);
    if (!buildRec?.buildInputs) {
      return { ok: false, code: "NO_BUILD", message: "Recalculate to generate this scenario." };
    }

    const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
    const dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
    dataset.meta = {
      ...(dataset.meta ?? {}),
      buildInputsHash: String(buildRec.buildInputsHash ?? ""),
      lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
      scenarioKey,
      scenarioId,
    };

    return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset };
  } catch (e) {
    console.error("[usageSimulator/service] getSimulatedUsageForHouseScenario failed", e);
    return { ok: false, code: "INTERNAL_ERROR", message: "Internal error" };
  }
}

export async function listSimulatedBuildAvailability(args: {
  userId: string;
  houseId: string;
}): Promise<
  | {
      ok: true;
      houseId: string;
      builds: Array<{
        scenarioKey: string;
        scenarioId: string | null;
        scenarioName: string;
        mode: string;
        baseKind: string;
        buildInputsHash: string;
        lastBuiltAt: string | null;
        canonicalEndMonth: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const house = await prisma.houseAddress
    .findFirst({ where: { id: args.houseId, userId: args.userId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!house) return { ok: false, error: "house_not_found" };

  const rows = await (prisma as any).usageSimulatorBuild
    .findMany({
      where: { userId: args.userId, houseId: args.houseId },
      select: { scenarioKey: true, mode: true, baseKind: true, buildInputsHash: true, lastBuiltAt: true, canonicalEndMonth: true },
      orderBy: [{ lastBuiltAt: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const scenarioIds = rows.map((r: any) => String(r?.scenarioKey ?? "")).filter((k: string) => k && k !== "BASELINE");
  const scenarioNameById = new Map<string, string>();
  if (scenarioIds.length) {
    const scenRows = await (prisma as any).usageSimulatorScenario
      .findMany({
        where: { id: { in: scenarioIds }, userId: args.userId, houseId: args.houseId },
        select: { id: true, name: true },
      })
      .catch(() => []);
    for (const s of scenRows) scenarioNameById.set(String(s.id), String(s.name ?? ""));
  }

  const builds = rows.map((r: any) => {
    const scenarioKey = String(r?.scenarioKey ?? "BASELINE");
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    return {
      scenarioKey,
      scenarioId,
      scenarioName: scenarioKey === "BASELINE" ? "Baseline" : scenarioNameById.get(scenarioKey) ?? "Scenario",
      mode: String(r?.mode ?? ""),
      baseKind: String(r?.baseKind ?? ""),
      buildInputsHash: String(r?.buildInputsHash ?? ""),
      lastBuiltAt: r?.lastBuiltAt ? new Date(r.lastBuiltAt).toISOString() : null,
      canonicalEndMonth: String(r?.canonicalEndMonth ?? ""),
    };
  });

  return { ok: true, houseId: args.houseId, builds };
}

function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

async function requireHouseForUser(args: { userId: string; houseId: string }) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true },
  });
  return h ?? null;
}

export async function listScenarios(args: { userId: string; houseId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId: args.userId, houseId: args.houseId, archivedAt: null },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
    .catch(() => []);
  return { ok: true as const, scenarios };
}

export async function createScenario(args: { userId: string; houseId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .create({
      data: { userId: args.userId, houseId: args.houseId, name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      // Unique constraint on (userId, houseId, name)
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function renameScenario(args: { userId: string; houseId: string; scenarioId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .update({
      where: { id: args.scenarioId },
      data: { name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function archiveScenario(args: { userId: string; houseId: string; scenarioId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  await (prisma as any).usageSimulatorScenario.update({ where: { id: args.scenarioId }, data: { archivedAt: new Date() } }).catch(() => null);
  return { ok: true as const };
}

export async function listScenarioEvents(args: { userId: string; houseId: string; scenarioId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const events = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: args.scenarioId },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
      orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    .catch(() => []);
  return { ok: true as const, events };
}

export async function addScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  effectiveMonth: string;
  kind: string;
  payloadJson: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const effectiveMonth = String(args.effectiveMonth ?? "").trim();
  if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };

  const kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  const payloadJson = args.payloadJson ?? {};

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .create({
      data: { scenarioId: args.scenarioId, effectiveMonth, kind, payloadJson },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson, createdAt: true, updatedAt: true },
    })
    .catch(() => null);
  if (!event) return { ok: false as const, error: "event_create_failed" };
  return { ok: true as const, event };
}

export async function updateScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  eventId: string;
  effectiveMonth?: string;
  kind?: string;
  payloadJson?: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const data: any = {};
  if (args.effectiveMonth !== undefined) {
    const effectiveMonth = String(args.effectiveMonth ?? "").trim();
    if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };
    data.effectiveMonth = effectiveMonth;
  }
  if (args.kind !== undefined) data.kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  if (args.payloadJson !== undefined) data.payloadJson = args.payloadJson ?? {};

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .update({
      where: { id: String(args.eventId ?? "") },
      data,
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const, event };
}

export async function deleteScenarioEvent(args: { userId: string; houseId: string; scenarioId: string; eventId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .delete({ where: { id: String(args.eventId ?? "") }, select: { id: true, scenarioId: true } })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const };
}

export async function getSimulatorRequirements(args: { userId: string; houseId: string; mode: SimulatorMode; now?: Date }) {
  const house = await prisma.houseAddress
    .findFirst({ where: { id: args.houseId, userId: args.userId, archivedAt: null }, select: { id: true, esiid: true } })
    .catch(() => null);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId: args.userId, houseId: args.houseId } }, select: { payload: true } })
      .catch(() => null),
    (homeDetailsPrisma as any).homeProfileSimulated.findUnique({ where: { userId_houseId: { userId: args.userId, houseId: args.houseId } } }).catch(() => null),
    (appliancesPrisma as any).applianceProfileSimulated
      .findUnique({ where: { userId_houseId: { userId: args.userId, houseId: args.houseId } }, select: { appliancesJson: true } })
      .catch(() => null),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode: args.mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec
    ? {
        homeAge: homeRec.homeAge,
        homeStyle: homeRec.homeStyle,
        squareFeet: homeRec.squareFeet,
        stories: homeRec.stories,
        insulationType: homeRec.insulationType,
        windowType: homeRec.windowType,
        foundation: homeRec.foundation,
        ledLights: homeRec.ledLights,
        smartThermostat: homeRec.smartThermostat,
        summerTemp: homeRec.summerTemp,
        winterTemp: homeRec.winterTemp,
        occupantsWork: homeRec.occupantsWork,
        occupantsSchool: homeRec.occupantsSchool,
        occupantsHomeAllDay: homeRec.occupantsHomeAllDay,
        fuelConfiguration: homeRec.fuelConfiguration,
      }
    : null;

  const hasSmt = house.esiid ? await hasSmtIntervals({ esiid: house.esiid, canonicalMonths: canonical.months }) : false;
  const req = computeRequirements(
    { manualUsagePayload: manualUsagePayload as any, homeProfile: homeProfile as any, applianceProfile: applianceProfile as any, hasSmtIntervals: hasSmt },
    args.mode,
  );

  return { ok: true as const, canRecalc: req.canRecalc, missingItems: req.missingItems, hasSmtIntervals: hasSmt, canonicalEndMonth: canonical.endMonth };
}

