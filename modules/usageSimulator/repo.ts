import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";

export function normalizeScenarioKey(scenarioId: string | null | undefined): string {
  const s = String(scenarioId ?? "").trim();
  if (!s) return "BASELINE";
  if (s.toLowerCase() === "baseline") return "BASELINE";
  return s;
}

export async function loadManualUsagePayload(args: { userId: string; houseId: string }) {
  const rec = await (prisma as any).manualUsageInput
    .findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      select: { payload: true },
    })
    .catch(() => null);
  return (rec?.payload as any) ?? null;
}

export async function loadHomeProfileSimulated(args: { userId: string; houseId: string }) {
  const rec = await (homeDetailsPrisma as any).homeProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
    })
    .catch(() => null);
  return rec ?? null;
}

export async function loadApplianceProfileSimulated(args: { userId: string; houseId: string }) {
  const rec = await (appliancesPrisma as any).applianceProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      select: { appliancesJson: true },
    })
    .catch(() => null);
  return (rec?.appliancesJson as any) ?? null;
}

export async function loadHouseForSimulator(args: { userId: string; houseId: string }) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  return h ?? null;
}

export async function loadExistingSimulatorBuild(args: { userId: string; houseId: string; scenarioKey?: string }) {
  const scenarioKey = String(args.scenarioKey ?? "BASELINE");
  const rec = await (prisma as any).usageSimulatorBuild
    .findUnique({
      where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
      select: { buildInputs: true, baseKind: true, mode: true, buildInputsHash: true, lastBuiltAt: true },
    })
    .catch(() => null);
  return rec ?? null;
}

export async function upsertSimulatorBuild(args: {
  userId: string;
  houseId: string;
  scenarioKey: string;
  mode: string;
  baseKind: string;
  canonicalEndMonth: string;
  canonicalMonths: string[];
  buildInputs: any;
  buildInputsHash: string;
  versions: {
    estimatorVersion: string;
    reshapeCoeffVersion: string;
    intradayTemplateVersion: string;
    smtShapeDerivationVersion: string;
  };
}) {
  await (prisma as any).usageSimulatorBuild.upsert({
    where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: args.scenarioKey } },
    create: {
      userId: args.userId,
      houseId: args.houseId,
      scenarioKey: args.scenarioKey,
      mode: args.mode,
      baseKind: args.baseKind,
      canonicalEndMonth: args.canonicalEndMonth,
      canonicalMonthsJson: args.canonicalMonths,
      buildInputs: args.buildInputs,
      buildInputsHash: args.buildInputsHash,
      estimatorVersion: args.versions.estimatorVersion,
      reshapeCoeffVersion: args.versions.reshapeCoeffVersion,
      intradayTemplateVersion: args.versions.intradayTemplateVersion,
      smtShapeDerivationVersion: args.versions.smtShapeDerivationVersion,
      lastBuiltAt: new Date(),
    },
    update: {
      mode: args.mode,
      baseKind: args.baseKind,
      canonicalEndMonth: args.canonicalEndMonth,
      canonicalMonthsJson: args.canonicalMonths,
      buildInputs: args.buildInputs,
      buildInputsHash: args.buildInputsHash,
      estimatorVersion: args.versions.estimatorVersion,
      reshapeCoeffVersion: args.versions.reshapeCoeffVersion,
      intradayTemplateVersion: args.versions.intradayTemplateVersion,
      smtShapeDerivationVersion: args.versions.smtShapeDerivationVersion,
      lastBuiltAt: new Date(),
    },
  });
}

export async function listScenariosForHouse(args: { userId: string; houseId: string }) {
  const rows = await prisma.usageSimulatorScenario.findMany({
    where: { userId: args.userId, houseId: args.houseId, archivedAt: null },
    select: { id: true, name: true, createdAt: true, updatedAt: true, archivedAt: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows;
}

export async function createScenarioForHouse(args: { userId: string; houseId: string; name: string }) {
  const row = await prisma.usageSimulatorScenario.create({
    data: { userId: args.userId, houseId: args.houseId, name: args.name },
    select: { id: true, name: true, createdAt: true, updatedAt: true, archivedAt: true },
  });
  return row;
}

export async function loadScenario(args: { userId: string; houseId: string; scenarioId: string }) {
  const row = await prisma.usageSimulatorScenario.findFirst({
    where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null },
    select: { id: true, name: true, createdAt: true, updatedAt: true, archivedAt: true },
  });
  return row ?? null;
}

export async function renameScenario(args: { userId: string; houseId: string; scenarioId: string; name: string }) {
  const row = await prisma.usageSimulatorScenario.update({
    where: { id: args.scenarioId },
    data: { name: args.name },
    select: { id: true, name: true, createdAt: true, updatedAt: true, archivedAt: true, houseId: true, userId: true },
  });
  if (row.userId !== args.userId || row.houseId !== args.houseId) return null;
  return row;
}

export async function archiveScenario(args: { userId: string; houseId: string; scenarioId: string }) {
  const row = await prisma.usageSimulatorScenario.update({
    where: { id: args.scenarioId },
    data: { archivedAt: new Date() },
    select: { id: true, houseId: true, userId: true, archivedAt: true },
  });
  if (row.userId !== args.userId || row.houseId !== args.houseId) return null;
  return row;
}

export async function listScenarioEvents(args: { scenarioId: string }) {
  const rows = await prisma.usageSimulatorScenarioEvent.findMany({
    where: { scenarioId: args.scenarioId },
    select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows;
}

export async function addScenarioEvent(args: { scenarioId: string; effectiveMonth: string; kind: string; payloadJson: any }) {
  const row = await prisma.usageSimulatorScenarioEvent.create({
    data: { scenarioId: args.scenarioId, effectiveMonth: args.effectiveMonth, kind: args.kind, payloadJson: args.payloadJson },
    select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
  });
  return row;
}

export async function updateScenarioEvent(args: { scenarioId: string; eventId: string; effectiveMonth?: string; kind?: string; payloadJson?: any }) {
  const row = await prisma.usageSimulatorScenarioEvent.update({
    where: { id: args.eventId },
    data: {
      ...(args.effectiveMonth ? { effectiveMonth: args.effectiveMonth } : {}),
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.payloadJson !== undefined ? { payloadJson: args.payloadJson } : {}),
    },
    select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
  });
  if (row.scenarioId !== args.scenarioId) return null;
  return row;
}

export async function deleteScenarioEvent(args: { scenarioId: string; eventId: string }) {
  const row = await prisma.usageSimulatorScenarioEvent.delete({
    where: { id: args.eventId },
    select: { id: true, scenarioId: true },
  });
  if (row.scenarioId !== args.scenarioId) return null;
  return row;
}

