import { getTemplateByKey, isAllowedUpgradeType, isAllowedChangeType } from "./catalog";
import type { ScheduleWindow } from "./catalog-types";

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;

function parseDateOnly(s: string): Date | null {
  if (!dateOnlyRegex.test(String(s).trim())) return null;
  const d = new Date(String(s).trim() + "T12:00:00.000Z");
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Get value at path; path is "quantity" | "units" | "before.x" | "after.x" | "inputs.x" | "inputs.solar.kwDc" etc. */
function getValueAtPath(
  payload: {
    quantity?: number | null;
    units?: string | null;
    beforeJson?: Record<string, unknown> | null;
    afterJson?: Record<string, unknown> | null;
    inputsJson?: Record<string, unknown> | null;
  },
  path: string
): unknown {
  const p = path.trim();
  if (p === "quantity") return payload.quantity;
  if (p === "units") return payload.units;
  const parts = p.split(".");
  if (parts[0] === "before" && parts.length >= 2) {
    let cur: unknown = payload.beforeJson ?? (payload as any).before;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as any)?.[parts[i]];
    return cur;
  }
  if (parts[0] === "after" && parts.length >= 2) {
    let cur: unknown = payload.afterJson ?? (payload as any).after;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as any)?.[parts[i]];
    return cur;
  }
  if (parts[0] === "inputs" && parts.length >= 2) {
    let cur: unknown = payload.inputsJson ?? (payload as any).inputs;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as any)?.[parts[i]];
    return cur;
  }
  return undefined;
}

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Validate scheduleWindows array: [{ start: "HH:mm", end: "HH:mm" }, ...] */
function validateScheduleWindows(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  if (v.length < 1) return false;
  for (const item of v) {
    if (!isPlainObject(item)) return false;
    const start = String((item as any).start ?? "").trim();
    const end = String((item as any).end ?? "").trim();
    if (!timeRegex.test(start) || !timeRegex.test(end)) return false;
  }
  return true;
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

/** Payload shape for validateUpgradeActionPayload (create/update). */
export type UpgradeActionPayload = {
  upgradeType: string;
  changeType: string;
  effectiveDate?: string | null;
  effectiveEndDate?: string | null;
  quantity?: number | null;
  units?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  inputsJson?: Record<string, unknown> | null;
  notes?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
};

/**
 * Validate payload against base rules + template requiredPaths.
 * Use for both create and update (server-side).
 */
export function validateUpgradeActionPayload(payload: unknown): { ok: true; value: UpgradeActionPayload } | { ok: false; error: string } {
  const b = payload as any;
  const upgradeType = typeof b?.upgradeType === "string" ? b.upgradeType.trim() : "";
  const changeType = typeof b?.changeType === "string" ? b.changeType.trim() : "";
  const effectiveDate = typeof b?.effectiveDate === "string" ? b.effectiveDate.trim().slice(0, 10) : null;

  if (!upgradeType) return { ok: false, error: "upgradeType_required" };
  if (!changeType) return { ok: false, error: "changeType_required" };
  if (!isAllowedChangeType(changeType)) return { ok: false, error: "changeType_invalid" };
  if (!isAllowedUpgradeType(upgradeType)) return { ok: false, error: "upgradeType_invalid" };
  if (!effectiveDate || !dateOnlyRegex.test(effectiveDate)) return { ok: false, error: "effectiveDate_required" };

  const template = getTemplateByKey(upgradeType);
  if (!template) return { ok: false, error: "upgradeType_invalid" };

  const beforeJson = isPlainObject(b?.beforeJson) ? b.beforeJson : isPlainObject(b?.before) ? b.before : {};
  const afterJson = isPlainObject(b?.afterJson) ? b.afterJson : isPlainObject(b?.after) ? b.after : {};
  const inputsJson = isPlainObject(b?.inputsJson) ? b.inputsJson : isPlainObject(b?.inputs) ? b.inputs : {};
  const payloadForPath: UpgradeActionPayload = {
    upgradeType,
    changeType,
    effectiveDate,
    effectiveEndDate: typeof b?.effectiveEndDate === "string" ? b.effectiveEndDate.trim().slice(0, 10) || null : null,
    quantity: typeof b?.quantity === "number" && Number.isFinite(b.quantity) ? b.quantity : null,
    units: typeof b?.units === "string" ? b.units.trim() || null : null,
    beforeJson,
    afterJson,
    inputsJson,
    notes: typeof b?.notes === "string" ? b.notes.trim() || null : null,
    before: beforeJson,
    after: afterJson,
    inputs: inputsJson,
  };

  for (const path of template.requiredPaths) {
    const val = getValueAtPath(payloadForPath, path);
    if (path === "quantity") {
      if (template.requiresQuantity && (val === undefined || val === null || !Number.isFinite(Number(val)))) {
        return { ok: false, error: `required_path_missing: ${path}` };
      }
      continue;
    }
    if (path === "units") {
      if (template.requiresQuantity && !isPresent(val)) return { ok: false, error: `required_path_missing: ${path}` };
      continue;
    }
    if (path === "inputs.scheduleWindows") {
      if (!validateScheduleWindows(val)) return { ok: false, error: "inputs.scheduleWindows must be at least one window with start/end HH:mm" };
      continue;
    }
    if (!isPresent(val)) return { ok: false, error: `required_path_missing: ${path}` };
  }

  return { ok: true, value: payloadForPath };
}

export function validateCreateLedger(body: unknown): { ok: true; value: CreateLedgerInput } | { ok: false; error: string } {
  const v = validateUpgradeActionPayload(body);
  if (!v.ok) return v;
  const { value } = v;
  const createValue: CreateLedgerInput = {
    houseId: (body as any)?.houseId != null ? String((body as any).houseId).trim() || undefined : undefined,
    houseState: (body as any)?.houseState != null ? String((body as any).houseState).trim() || undefined : undefined,
    tdspRegion: (body as any)?.tdspRegion != null ? String((body as any).tdspRegion).trim() || undefined : undefined,
    scenarioId: (body as any)?.scenarioId != null ? String((body as any).scenarioId).trim() || undefined : undefined,
    upgradeType: value.upgradeType,
    changeType: value.changeType,
    quantity: value.quantity ?? undefined,
    units: value.units ?? undefined,
    effectiveDate: value.effectiveDate ?? undefined,
    effectiveEndDate: value.effectiveEndDate ?? undefined,
    beforeJson: value.beforeJson ?? undefined,
    afterJson: value.afterJson ?? undefined,
    inputsJson: value.inputsJson ?? undefined,
    notes: value.notes ?? undefined,
    source: (body as any)?.source != null ? String((body as any).source).trim() || undefined : undefined,
  };
  return { ok: true, value: createValue };
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
