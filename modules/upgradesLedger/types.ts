import { isAllowedUpgradeType, isAllowedChangeType } from "./catalog";

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(s: string): Date | null {
  if (!dateOnlyRegex.test(String(s).trim())) return null;
  const d = new Date(String(s).trim() + "T12:00:00.000Z");
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export type CreateLedgerInput = {
  houseId?: string;
  houseState?: string;
  tdspRegion?: string;
  scenarioId?: string;
  upgradeType: string;
  changeType: string;
  quantity?: number;
  units?: string;
  effectiveDate?: string;
  effectiveEndDate?: string;
  beforeJson?: Record<string, unknown>;
  afterJson?: Record<string, unknown>;
  inputsJson?: Record<string, unknown>;
  notes?: string;
  source?: string;
};

export type UpdateLedgerInput = {
  houseId?: string;
  houseState?: string;
  tdspRegion?: string;
  scenarioId?: string;
  scenarioEventId?: string;
  upgradeType?: string;
  changeType?: string;
  quantity?: number | null;
  units?: string | null;
  effectiveDate?: string | null;
  effectiveEndDate?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  inputsJson?: Record<string, unknown> | null;
  notes?: string | null;
  status?: string;
};

export type ListLedgerQuery = {
  houseId?: string;
  scenarioId?: string;
  status?: string;
};

export function validateCreateLedger(body: unknown): { ok: true; value: CreateLedgerInput } | { ok: false; error: string } {
  const b = body as any;
  const upgradeType = typeof b?.upgradeType === "string" ? b.upgradeType.trim() : "";
  const changeType = typeof b?.changeType === "string" ? b.changeType.trim() : "";
  if (!upgradeType) return { ok: false, error: "upgradeType_required" };
  if (!changeType) return { ok: false, error: "changeType_required" };
  if (!isAllowedChangeType(changeType)) return { ok: false, error: "changeType_invalid" };
  if (!isAllowedUpgradeType(upgradeType)) return { ok: false, error: "upgradeType_invalid" };

  const beforeJson = b?.beforeJson;
  const afterJson = b?.afterJson;
  const inputsJson = b?.inputsJson;
  if (beforeJson !== undefined && beforeJson !== null && !isPlainObject(beforeJson)) return { ok: false, error: "beforeJson_must_be_object" };
  if (afterJson !== undefined && afterJson !== null && !isPlainObject(afterJson)) return { ok: false, error: "afterJson_must_be_object" };
  if (inputsJson !== undefined && inputsJson !== null && !isPlainObject(inputsJson)) return { ok: false, error: "inputsJson_must_be_object" };

  const quantity = typeof b?.quantity === "number" && Number.isFinite(b.quantity) ? b.quantity : undefined;
  const value: CreateLedgerInput = {
    houseId: typeof b?.houseId === "string" ? b.houseId.trim() || undefined : undefined,
    houseState: typeof b?.houseState === "string" ? b.houseState.trim() || undefined : undefined,
    tdspRegion: typeof b?.tdspRegion === "string" ? b.tdspRegion.trim() || undefined : undefined,
    scenarioId: typeof b?.scenarioId === "string" ? b.scenarioId.trim() || undefined : undefined,
    upgradeType,
    changeType,
    quantity,
    units: typeof b?.units === "string" ? b.units.trim() || undefined : undefined,
    effectiveDate: typeof b?.effectiveDate === "string" ? b.effectiveDate.trim() || undefined : undefined,
    effectiveEndDate: typeof b?.effectiveEndDate === "string" ? b.effectiveEndDate.trim() || undefined : undefined,
    beforeJson: isPlainObject(beforeJson) ? beforeJson : undefined,
    afterJson: isPlainObject(afterJson) ? afterJson : undefined,
    inputsJson: isPlainObject(inputsJson) ? inputsJson : undefined,
    notes: typeof b?.notes === "string" ? b.notes.trim() || undefined : undefined,
    source: typeof b?.source === "string" ? b.source.trim() || undefined : undefined,
  };
  return { ok: true, value };
}

export function validateUpdateLedger(body: unknown): { ok: true; value: UpdateLedgerInput } | { ok: false; error: string } {
  const b = body as any;
  const upgradeType = typeof b?.upgradeType === "string" ? b.upgradeType.trim() : undefined;
  const changeType = typeof b?.changeType === "string" ? b.changeType.trim() : undefined;
  if (upgradeType !== undefined && !isAllowedUpgradeType(upgradeType)) return { ok: false, error: "upgradeType_invalid" };
  if (changeType !== undefined && !isAllowedChangeType(changeType)) return { ok: false, error: "changeType_invalid" };

  const beforeJson = b?.beforeJson;
  const afterJson = b?.afterJson;
  const inputsJson = b?.inputsJson;
  if (beforeJson !== undefined && beforeJson !== null && !isPlainObject(beforeJson)) return { ok: false, error: "beforeJson_must_be_object" };
  if (afterJson !== undefined && afterJson !== null && !isPlainObject(afterJson)) return { ok: false, error: "afterJson_must_be_object" };
  if (inputsJson !== undefined && inputsJson !== null && !isPlainObject(inputsJson)) return { ok: false, error: "inputsJson_must_be_object" };

  const value: UpdateLedgerInput = {};
  if (b?.houseId !== undefined) value.houseId = typeof b.houseId === "string" ? b.houseId.trim() || undefined : undefined;
  if (b?.houseState !== undefined) value.houseState = typeof b.houseState === "string" ? b.houseState.trim() || undefined : undefined;
  if (b?.tdspRegion !== undefined) value.tdspRegion = typeof b.tdspRegion === "string" ? b.tdspRegion.trim() || undefined : undefined;
  if (b?.scenarioId !== undefined) value.scenarioId = typeof b.scenarioId === "string" ? b.scenarioId.trim() || undefined : undefined;
  if (b?.scenarioEventId !== undefined) value.scenarioEventId = typeof b.scenarioEventId === "string" ? b.scenarioEventId.trim() || undefined : undefined;
  if (upgradeType !== undefined) value.upgradeType = upgradeType;
  if (changeType !== undefined) value.changeType = changeType;
  if (b?.quantity !== undefined) value.quantity = typeof b.quantity === "number" && Number.isFinite(b.quantity) ? b.quantity : null;
  if (b?.units !== undefined) value.units = typeof b.units === "string" ? b.units.trim() || null : null;
  if (b?.effectiveDate !== undefined) value.effectiveDate = typeof b.effectiveDate === "string" ? b.effectiveDate.trim() || null : null;
  if (b?.effectiveEndDate !== undefined) value.effectiveEndDate = typeof b.effectiveEndDate === "string" ? b.effectiveEndDate.trim() || null : null;
  if (b?.beforeJson !== undefined) value.beforeJson = isPlainObject(beforeJson) ? beforeJson : null;
  if (b?.afterJson !== undefined) value.afterJson = isPlainObject(afterJson) ? afterJson : null;
  if (b?.inputsJson !== undefined) value.inputsJson = isPlainObject(inputsJson) ? inputsJson : null;
  if (b?.notes !== undefined) value.notes = typeof b.notes === "string" ? b.notes.trim() || null : null;
  if (b?.status !== undefined) value.status = typeof b.status === "string" ? b.status.trim() : undefined;
  return { ok: true, value };
}

export function toEffectiveDate(s: string | undefined): Date | null {
  if (!s || !dateOnlyRegex.test(String(s).trim())) return null;
  return parseDateOnly(String(s).trim());
}

export function toEffectiveEndDate(s: string | undefined): Date | null {
  if (s === undefined || s === null || s === "") return null;
  if (!dateOnlyRegex.test(String(s).trim())) return null;
  return parseDateOnly(String(s).trim());
}

export function fromEffectiveDate(d: Date | null): string | null {
  if (!d || !Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
