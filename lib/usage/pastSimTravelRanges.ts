import { prisma } from "@/lib/db";

export type PastSimTravelRange = { startDate: string; endDate: string };

export const PAST_CORRECTED_SCENARIO_NAME = "Past (Corrected)";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizePastSimTravelRanges(
  ranges: ReadonlyArray<{ startDate?: unknown; endDate?: unknown }> | null | undefined
): PastSimTravelRange[] {
  const out: PastSimTravelRange[] = [];
  const seen = new Set<string>();
  for (const range of ranges ?? []) {
    const startDate = asDateKey(range?.startDate);
    const endDate = asDateKey(range?.endDate);
    if (!startDate || !endDate) continue;
    const key = `${startDate}|${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  return out.sort((left, right) =>
    left.startDate === right.startDate ? left.endDate.localeCompare(right.endDate) : left.startDate.localeCompare(right.startDate)
  );
}

function travelRangesFromScenarioEvents(
  events: ReadonlyArray<{ kind?: unknown; payloadJson?: unknown }>
): PastSimTravelRange[] {
  return normalizePastSimTravelRanges(
    (events ?? [])
      .filter((event) => String(event?.kind ?? "") === "TRAVEL_RANGE")
      .map((event) => {
        const payload =
          event?.payloadJson && typeof event.payloadJson === "object" && !Array.isArray(event.payloadJson)
            ? (event.payloadJson as Record<string, unknown>)
            : {};
        return { startDate: payload.startDate, endDate: payload.endDate };
      })
  );
}

/**
 * Past travel for recalc: scenario events on the build house, plus source-house Past
 * scenario when One Path runs on a lab test home (actualContextHouseId !== houseId).
 */
export async function resolvePastSimTravelRangesForRecalc(args: {
  prisma: {
    usageSimulatorScenario?: {
      findFirst: (query: unknown) => Promise<{ id: string } | null>;
    };
    usageSimulatorScenarioEvent?: {
      findMany: (query: unknown) => Promise<Array<{ kind: string; payloadJson: unknown }>>;
    };
    houseAddress?: {
      findUnique: (query: unknown) => Promise<{ userId: string } | null>;
    };
  };
  userId: string;
  houseId: string;
  actualContextHouseId: string;
  pastScenarioName: string;
  preLockboxTravelRanges?: ReadonlyArray<PastSimTravelRange>;
  scenarioTravelRanges?: ReadonlyArray<PastSimTravelRange>;
}): Promise<PastSimTravelRange[]> {
  const preLockbox = normalizePastSimTravelRanges(args.preLockboxTravelRanges);
  if (preLockbox.length > 0) return preLockbox;

  const merged = normalizePastSimTravelRanges(args.scenarioTravelRanges);

  const actualContextHouseId = String(args.actualContextHouseId ?? args.houseId).trim();
  const houseId = String(args.houseId).trim();
  if (!actualContextHouseId || actualContextHouseId === houseId) {
    return merged;
  }

  const scenarioModel = args.prisma.usageSimulatorScenario;
  const eventModel = args.prisma.usageSimulatorScenarioEvent;
  const houseModel = args.prisma.houseAddress;
  if (!scenarioModel?.findFirst || !eventModel?.findMany || !houseModel?.findUnique) {
    return merged;
  }

  const sourceOwner = await houseModel
    .findUnique({
      where: { id: actualContextHouseId },
      select: { userId: true },
    })
    .catch(() => null);
  const sourceUserId = String(sourceOwner?.userId ?? "").trim();
  if (!sourceUserId) return merged;

  const sourcePastScenario = await scenarioModel
    .findFirst({
      where: {
        userId: sourceUserId,
        houseId: actualContextHouseId,
        name: args.pastScenarioName,
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  if (!sourcePastScenario?.id) return merged;

  const sourceEvents = await eventModel
    .findMany({
      where: { scenarioId: String(sourcePastScenario.id) },
      select: { kind: true, payloadJson: true },
      orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    .catch(() => []);

  return normalizePastSimTravelRanges([...merged, ...travelRangesFromScenarioEvents(sourceEvents)]);
}

function travelRangesFromManualPayload(payload: unknown): PastSimTravelRange[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const travelRanges = (payload as { travelRanges?: unknown }).travelRanges;
  return normalizePastSimTravelRanges(Array.isArray(travelRanges) ? travelRanges : []);
}

/** Travel/vacant ranges from scenario events and saved manual payload for one house. */
export async function readTravelRangesForHouse(args: {
  userId: string;
  houseId: string;
}): Promise<PastSimTravelRange[]> {
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.houseId ?? "").trim();
  if (!userId || !houseId) return [];

  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId, houseId, archivedAt: null },
      select: { id: true },
    })
    .catch(() => []);
  const scenarioIds = (scenarios ?? []).map((scenario: { id: string }) => String(scenario.id));
  const events =
    scenarioIds.length > 0
      ? await (prisma as any).usageSimulatorScenarioEvent
          .findMany({
            where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
            select: { kind: true, payloadJson: true },
          })
          .catch(() => [])
      : [];

  const manualRec = await (prisma as any).manualUsageInput
    .findUnique({
      where: { userId_houseId: { userId, houseId } },
      select: { payload: true },
    })
    .catch(() => null);

  return normalizePastSimTravelRanges([
    ...travelRangesFromScenarioEvents(events ?? []),
    ...travelRangesFromManualPayload(manualRec?.payload),
  ]);
}

/** Lab seed / replace: prefer saved lab-home travel; fall back to linked source home. */
export async function resolveEffectiveTravelRangesForLabHome(args: {
  labOwnerUserId: string;
  labHouseId: string;
  sourceUserId: string;
  sourceHouseId: string;
}): Promise<PastSimTravelRange[]> {
  const labTravel = await readTravelRangesForHouse({
    userId: args.labOwnerUserId,
    houseId: args.labHouseId,
  });
  if (labTravel.length > 0) return labTravel;
  return readTravelRangesForHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
}

/** Replace all TRAVEL_RANGE events on the house Past (Corrected) scenario. */
export async function replacePastCorrectedScenarioTravelRanges(args: {
  userId: string;
  houseId: string;
  travelRanges: ReadonlyArray<PastSimTravelRange>;
  pastScenarioName?: string;
}): Promise<void> {
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.houseId ?? "").trim();
  if (!userId || !houseId) return;

  const pastScenarioName = args.pastScenarioName ?? PAST_CORRECTED_SCENARIO_NAME;
  const ranges = normalizePastSimTravelRanges(args.travelRanges);

  await (prisma as any).$transaction(async (tx: any) => {
    let pastScenario = await tx.usageSimulatorScenario.findFirst({
      where: {
        userId,
        houseId,
        name: pastScenarioName,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!pastScenario?.id) {
      pastScenario = await tx.usageSimulatorScenario.create({
        data: {
          userId,
          houseId,
          name: pastScenarioName,
        },
        select: { id: true },
      });
    }
    await tx.usageSimulatorScenarioEvent.deleteMany({
      where: {
        scenarioId: String(pastScenario.id),
        kind: "TRAVEL_RANGE",
      },
    });
    if (ranges.length > 0) {
      await tx.usageSimulatorScenarioEvent.createMany({
        data: ranges.map((range) => ({
          scenarioId: String(pastScenario.id),
          effectiveMonth: range.startDate.slice(0, 7),
          kind: "TRAVEL_RANGE",
          payloadJson: { startDate: range.startDate, endDate: range.endDate },
        })),
      });
    }
  });
}
