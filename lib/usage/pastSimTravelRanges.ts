export type PastSimTravelRange = { startDate: string; endDate: string };

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
