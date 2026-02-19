import type { CreateLedgerInput, UpdateLedgerInput, ListLedgerQuery } from "./types";
import { validateCreateLedger, validateUpdateLedger, fromEffectiveDate } from "./types";
import * as repo from "./repo";

export type LedgerDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
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
  effectiveDate: string | null;
  effectiveEndDate: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  inputsJson: Record<string, unknown> | null;
  notes: string | null;
};

function rowToDto(r: repo.LedgerRow): LedgerDto {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    userId: r.userId,
    houseId: r.houseId,
    houseState: r.houseState,
    tdspRegion: r.tdspRegion,
    scenarioId: r.scenarioId,
    scenarioEventId: r.scenarioEventId,
    status: r.status,
    source: r.source,
    upgradeType: r.upgradeType,
    changeType: r.changeType,
    quantity: r.quantity,
    units: r.units,
    effectiveDate: r.effectiveDate ? fromEffectiveDate(r.effectiveDate) : null,
    effectiveEndDate: r.effectiveEndDate ? fromEffectiveDate(r.effectiveEndDate) : null,
    beforeJson: (r.beforeJson as Record<string, unknown>) ?? null,
    afterJson: (r.afterJson as Record<string, unknown>) ?? null,
    inputsJson: (r.inputsJson as Record<string, unknown>) ?? null,
    notes: r.notes,
  };
}

function formatUpgradesDbError(e: any): string {
  const msg = typeof e?.message === "string" ? e.message : String(e ?? "");
  const rawCode = (e as any)?.code ?? (e as any)?.errorCode ?? null;
  const code = typeof rawCode === "string" ? rawCode : null;
  if (code) return `upgrades_db_error_${code}`;
  if (/UPGRADES_DATABASE_URL/i.test(msg)) return "upgrades_db_missing_env";
  if (/P1001/i.test(msg)) return "upgrades_db_unreachable";
  if (/permission denied/i.test(msg)) return "upgrades_db_permission_denied";
  if (/timeout/i.test(msg)) return "upgrades_db_timeout";
  return "upgrades_db_error";
}

export type ListResult = { ok: true; data: LedgerDto[] } | { ok: false; error: string; message?: string };
export type GetResult = { ok: true; data: LedgerDto } | { ok: false; error: string; message?: string };
export type CreateResult = { ok: true; data: LedgerDto } | { ok: false; error: string; message?: string };
export type UpdateResult = { ok: true; data: LedgerDto } | { ok: false; error: string; message?: string };
export type DeleteResult = { ok: true } | { ok: false; error: string; message?: string };

export async function getLedger(userId: string, id: string): Promise<GetResult> {
  try {
    const row = await repo.findLedgerByIdAndUser(id, userId);
    if (!row) return { ok: false, error: "not_found" };
    return { ok: true, data: rowToDto(row) };
  } catch (e: any) {
    console.error("[upgradesLedger/service] getLedger failed", e);
    return { ok: false, error: formatUpgradesDbError(e), message: e?.message };
  }
}

export async function listLedger(userId: string, query: ListLedgerQuery): Promise<ListResult> {
  const status = query.status !== undefined ? query.status : "ACTIVE";
  try {
    const rows = await repo.listLedgerRows(userId, { ...query, status });
    return { ok: true, data: rows.map(rowToDto) };
  } catch (e: any) {
    console.error("[upgradesLedger/service] listLedger failed", e);
    return { ok: false, error: formatUpgradesDbError(e), message: e?.message };
  }
}

export async function createLedger(userId: string, body: unknown): Promise<CreateResult> {
  const v = validateCreateLedger(body);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const row = await repo.createLedgerRow(userId, v.value);
    if (!row) return { ok: false, error: "create_failed" };
    return { ok: true, data: rowToDto(row) };
  } catch (e: any) {
    console.error("[upgradesLedger/service] createLedger failed", e);
    return { ok: false, error: formatUpgradesDbError(e), message: e?.message };
  }
}

export async function updateLedger(userId: string, id: string, body: unknown): Promise<UpdateResult> {
  const v = validateUpdateLedger(body);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const row = await repo.updateLedgerRow(id, userId, v.value);
    if (!row) return { ok: false, error: "not_found" };
    return { ok: true, data: rowToDto(row) };
  } catch (e: any) {
    console.error("[upgradesLedger/service] updateLedger failed", e);
    return { ok: false, error: formatUpgradesDbError(e), message: e?.message };
  }
}

export async function softDeleteLedger(userId: string, id: string): Promise<DeleteResult> {
  try {
    const done = await repo.softDeleteLedgerRow(id, userId);
    return done ? { ok: true } : { ok: false, error: "not_found" };
  } catch (e: any) {
    console.error("[upgradesLedger/service] softDeleteLedger failed", e);
    return { ok: false, error: formatUpgradesDbError(e), message: e?.message };
  }
}

export async function linkScenarioEvent(args: {
  userId: string;
  ledgerId: string;
  scenarioEventId: string;
}): Promise<UpdateResult> {
  return updateLedger(args.userId, args.ledgerId, { scenarioEventId: args.scenarioEventId });
}
