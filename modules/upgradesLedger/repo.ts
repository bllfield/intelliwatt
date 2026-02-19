import { upgradesPrisma } from "@/lib/db/upgradesClient";
import type { CreateLedgerInput, UpdateLedgerInput, ListLedgerQuery } from "./types";
import { toEffectiveDate, toEffectiveEndDate } from "./types";

export type LedgerRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  houseId: string | null;
  houseState: string | null;
  tdspRegion: string | null;
  scenarioId: string | null;
  scenarioEventId: string | null;
  status: string;
  source: string | null;
  upgradeType: string;
  changeType: string;
  quantity: number | null;
  units: string | null;
  effectiveDate: Date | null;
  effectiveEndDate: Date | null;
  vendorId: string | null;
  costUsd: number | null;
  costJson: unknown;
  measuredStartDate: Date | null;
  measuredEndDate: Date | null;
  beforeJson: unknown;
  afterJson: unknown;
  inputsJson: unknown;
  notes: string | null;
  impactMethod: string | null;
  deltaKwhAnnualMeasured: number | null;
  deltaKwhAnnualSimulated: number | null;
  deltaKwhMonthlyMeasuredJson: unknown;
  deltaKwhMonthlySimulatedJson: unknown;
  confidence: number | null;
  schemaVersion: string;
  calcVersion: string | null;
  normalizationVersion: string | null;
};

export async function createLedgerRow(userId: string, input: CreateLedgerInput): Promise<LedgerRow | null> {
  const db = upgradesPrisma;
  const effectiveDate = toEffectiveDate(input.effectiveDate) ?? null;
  const effectiveEndDate = toEffectiveEndDate(input.effectiveEndDate) ?? null;
  const rec = await (db as any).upgradeLedger.create({
    data: {
      userId,
      houseId: input.houseId ?? null,
      houseState: input.houseState ?? null,
      tdspRegion: input.tdspRegion ?? null,
      scenarioId: input.scenarioId ?? null,
      upgradeType: input.upgradeType,
      changeType: input.changeType,
      quantity: input.quantity ?? null,
      units: input.units ?? null,
      effectiveDate,
      effectiveEndDate,
      beforeJson: input.beforeJson ?? undefined,
      afterJson: input.afterJson ?? undefined,
      inputsJson: input.inputsJson ?? undefined,
      notes: input.notes ?? null,
      source: input.source ?? "USER",
      deltaKwhMonthlySimulatedJson: input.deltaKwhMonthlySimulatedJson ?? undefined,
      deltaKwhAnnualSimulated: input.deltaKwhAnnualSimulated ?? undefined,
    },
  });
  return rec as LedgerRow;
}

export async function findLedgerById(id: string): Promise<LedgerRow | null> {
  const db = upgradesPrisma;
  const rec = await (db as any).upgradeLedger.findUnique({ where: { id } });
  return rec as LedgerRow | null;
}

export async function findLedgerByIdAndUser(id: string, userId: string): Promise<LedgerRow | null> {
  const rec = await findLedgerById(id);
  return rec && rec.userId === userId ? rec : null;
}

export async function listLedgerRows(userId: string, query: ListLedgerQuery): Promise<LedgerRow[]> {
  const db = upgradesPrisma;
  const where: any = { userId };
  if (query.houseId) where.houseId = query.houseId;
  if (query.scenarioId) where.scenarioId = query.scenarioId;
  if (query.status !== undefined) where.status = query.status;
  const rows = await (db as any).upgradeLedger.findMany({
    where,
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows as LedgerRow[];
}

export async function updateLedgerRow(id: string, userId: string, input: UpdateLedgerInput): Promise<LedgerRow | null> {
  const existing = await findLedgerByIdAndUser(id, userId);
  if (!existing) return null;
  const db = upgradesPrisma;
  const data: any = {};
  if (input.houseId !== undefined) data.houseId = input.houseId ?? null;
  if (input.houseState !== undefined) data.houseState = input.houseState ?? null;
  if (input.tdspRegion !== undefined) data.tdspRegion = input.tdspRegion ?? null;
  if (input.scenarioId !== undefined) data.scenarioId = input.scenarioId ?? null;
  if (input.scenarioEventId !== undefined) data.scenarioEventId = input.scenarioEventId ?? null;
  if (input.upgradeType !== undefined) data.upgradeType = input.upgradeType;
  if (input.changeType !== undefined) data.changeType = input.changeType;
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (input.units !== undefined) data.units = input.units;
  if (input.effectiveDate !== undefined) data.effectiveDate = input.effectiveDate ? toEffectiveDate(input.effectiveDate) : null;
  if (input.effectiveEndDate !== undefined) data.effectiveEndDate = input.effectiveEndDate ? toEffectiveEndDate(input.effectiveEndDate) : null;
  if (input.beforeJson !== undefined) data.beforeJson = input.beforeJson;
  if (input.afterJson !== undefined) data.afterJson = input.afterJson;
  if (input.inputsJson !== undefined) data.inputsJson = input.inputsJson;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.status !== undefined) data.status = input.status;
  if (input.deltaKwhMonthlySimulatedJson !== undefined) data.deltaKwhMonthlySimulatedJson = input.deltaKwhMonthlySimulatedJson;
  if (input.deltaKwhAnnualSimulated !== undefined) data.deltaKwhAnnualSimulated = input.deltaKwhAnnualSimulated;
  const rec = await (db as any).upgradeLedger.update({ where: { id }, data });
  return rec as LedgerRow;
}

export async function softDeleteLedgerRow(id: string, userId: string): Promise<boolean> {
  const existing = await findLedgerByIdAndUser(id, userId);
  if (!existing) return false;
  const db = upgradesPrisma;
  await (db as any).upgradeLedger.update({ where: { id }, data: { status: "DELETED" } });
  return true;
}
