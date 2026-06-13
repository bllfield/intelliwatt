import { prisma } from "@/lib/db";

export const LAB_DISPATCH_SCENARIO_OWNERSHIP_INSTRUCTION =
  "Re-run prepare_dispatch_step after replacing the lab home.";

export type LabDispatchScenarioRow = {
  id: string;
  userId: string;
  houseId: string;
  name: string;
};

export type DispatchScenarioOwnershipFailure = {
  ok: false;
  error: "scenario_not_owned_by_dispatch_house" | "scenario_not_found";
  errorCode: "scenario_not_owned_by_dispatch_house" | "scenario_not_found";
  message: string;
  providedScenarioId: string;
  dispatchHouseId: string;
  actualScenarioHouseId: string | null;
  actualScenarioUserId: string | null;
  expectedScenarioName: string | null;
  actualScenarioName: string | null;
  instruction: string;
};

export async function loadLabDispatchScenarioById(
  scenarioId: string
): Promise<LabDispatchScenarioRow | null> {
  const id = String(scenarioId ?? "").trim();
  if (!id) return null;
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: { id, archivedAt: null },
      select: { id: true, userId: true, houseId: true, name: true },
    })
    .catch(() => null);
  if (!row?.id) return null;
  return {
    id: String(row.id),
    userId: String(row.userId ?? ""),
    houseId: String(row.houseId ?? ""),
    name: String(row.name ?? ""),
  };
}

export async function scenarioBelongsToDispatchHouse(args: {
  scenarioId: string;
  dispatchHouseId: string;
  ownerUserId: string;
}): Promise<boolean> {
  const scenarioId = String(args.scenarioId ?? "").trim();
  const dispatchHouseId = String(args.dispatchHouseId ?? "").trim();
  const ownerUserId = String(args.ownerUserId ?? "").trim();
  if (!scenarioId || !dispatchHouseId || !ownerUserId) return false;
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: { id: scenarioId, userId: ownerUserId, houseId: dispatchHouseId, archivedAt: null },
      select: { id: true },
    })
    .catch(() => null);
  return Boolean(row?.id);
}

export async function validateDispatchScenarioOwnership(args: {
  scenarioId: string;
  dispatchHouseId: string;
  ownerUserId: string;
  expectedScenarioName?: string | null;
}): Promise<{ ok: true; scenario: LabDispatchScenarioRow } | DispatchScenarioOwnershipFailure> {
  const providedScenarioId = String(args.scenarioId ?? "").trim();
  const dispatchHouseId = String(args.dispatchHouseId ?? "").trim();
  const ownerUserId = String(args.ownerUserId ?? "").trim();
  const expectedScenarioName =
    typeof args.expectedScenarioName === "string" && args.expectedScenarioName.trim()
      ? args.expectedScenarioName.trim()
      : null;

  if (!providedScenarioId || !dispatchHouseId || !ownerUserId) {
    return {
      ok: false,
      error: "scenario_not_found",
      errorCode: "scenario_not_found",
      message: "scenario_not_found",
      providedScenarioId,
      dispatchHouseId,
      actualScenarioHouseId: null,
      actualScenarioUserId: null,
      expectedScenarioName,
      actualScenarioName: null,
      instruction: LAB_DISPATCH_SCENARIO_OWNERSHIP_INSTRUCTION,
    };
  }

  const scenario = await loadLabDispatchScenarioById(providedScenarioId);
  if (!scenario) {
    return {
      ok: false,
      error: "scenario_not_found",
      errorCode: "scenario_not_found",
      message: "scenario_not_found",
      providedScenarioId,
      dispatchHouseId,
      actualScenarioHouseId: null,
      actualScenarioUserId: null,
      expectedScenarioName,
      actualScenarioName: null,
      instruction: LAB_DISPATCH_SCENARIO_OWNERSHIP_INSTRUCTION,
    };
  }

  if (scenario.houseId !== dispatchHouseId || scenario.userId !== ownerUserId) {
    return {
      ok: false,
      error: "scenario_not_owned_by_dispatch_house",
      errorCode: "scenario_not_owned_by_dispatch_house",
      message: "scenario_not_owned_by_dispatch_house",
      providedScenarioId,
      dispatchHouseId,
      actualScenarioHouseId: scenario.houseId,
      actualScenarioUserId: scenario.userId,
      expectedScenarioName,
      actualScenarioName: scenario.name,
      instruction: LAB_DISPATCH_SCENARIO_OWNERSHIP_INSTRUCTION,
    };
  }

  if (expectedScenarioName && scenario.name !== expectedScenarioName) {
    return {
      ok: false,
      error: "scenario_not_owned_by_dispatch_house",
      errorCode: "scenario_not_owned_by_dispatch_house",
      message: "scenario_not_owned_by_dispatch_house",
      providedScenarioId,
      dispatchHouseId,
      actualScenarioHouseId: scenario.houseId,
      actualScenarioUserId: scenario.userId,
      expectedScenarioName,
      actualScenarioName: scenario.name,
      instruction: LAB_DISPATCH_SCENARIO_OWNERSHIP_INSTRUCTION,
    };
  }

  return { ok: true, scenario };
}
