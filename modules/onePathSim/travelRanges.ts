import { prisma } from "@/lib/db";

export async function getOnePathTravelRangesFromDb(
  userId: string,
  houseId: string
): Promise<Array<{ startDate: string; endDate: string }>> {
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId, houseId, archivedAt: null },
      select: { id: true },
    })
    .catch(() => []);
  if (!scenarios?.length) return [];
  const scenarioIds = scenarios.map((scenario: { id: string }) => scenario.id);
  const events = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
      select: { payloadJson: true },
    })
    .catch(() => []);
  const seen = new Set<string>();
  const out: Array<{ startDate: string; endDate: string }> = [];
  for (const event of events ?? []) {
    const payload = (event as any)?.payloadJson ?? {};
    const startDate = typeof payload?.startDate === "string" ? String(payload.startDate).slice(0, 10) : "";
    const endDate = typeof payload?.endDate === "string" ? String(payload.endDate).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    const key = `${startDate}\t${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return out;
}
