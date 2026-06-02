import { prisma } from "@/lib/db";

/** Latest persisted build inputs for Past read/compare rehydration (shared User + One Path). */
export async function loadPastSimBuildInputsForRead(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
}): Promise<Record<string, unknown> | null> {
  const scenarioId = String(args.scenarioId ?? "").trim();
  if (!scenarioId) return null;
  const buildRec = await (prisma as any).usageSimulatorBuild
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.houseId,
        scenarioKey: scenarioId,
      },
      orderBy: { lastBuiltAt: "desc" },
      select: { buildInputs: true },
    })
    .catch(() => null);
  const buildInputs = buildRec?.buildInputs;
  return buildInputs && typeof buildInputs === "object" && !Array.isArray(buildInputs)
    ? (buildInputs as Record<string, unknown>)
    : null;
}
