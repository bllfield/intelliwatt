"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UPGRADE_CATALOG_GROUPS,
  CHANGE_TYPES,
  getTemplateByKey,
  type ChangeType,
  type UpgradeTemplate,
  type FieldDescriptor,
} from "@/components/upgrades/catalog";
import { TimeRangeList } from "@/components/upgrades/TimeRangeList";
import type { ScheduleWindow } from "@/modules/upgradesLedger/catalog-types";

type LedgerRow = {
  id: string;
  upgradeType: string;
  changeType: string;
  quantity: number | null;
  units: string | null;
  effectiveDate: string | null;
  effectiveEndDate: string | null;
  scenarioEventId: string | null;
  notes: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  inputsJson: Record<string, unknown> | null;
};

type ScenarioUpgradesEditorProps = {
  houseId: string;
  scenarioId: string;
  canonicalEndMonth?: string;
  onRecalc?: () => void;
};

type FormState = {
  changeType: ChangeType;
  upgradeType: string;
  effectiveDate: string;
  effectiveEndDate: string;
  quantity: string;
  units: string;
  notes: string;
  beforeJson: Record<string, unknown>;
  afterJson: Record<string, unknown>;
  inputsJson: Record<string, unknown>;
};

function getByPath(
  form: FormState,
  path: string
): string | number | string[] | ScheduleWindow[] | undefined | null {
  if (path === "quantity") return form.quantity === "" ? undefined : form.quantity;
  if (path === "units") return form.units === "" ? undefined : form.units;
  const parts = path.split(".");
  if (parts[0] === "before" && parts.length >= 2) {
    let cur: unknown = form.beforeJson;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as Record<string, unknown>)?.[parts[i]];
    return cur as string | number | string[] | ScheduleWindow[] | undefined | null;
  }
  if (parts[0] === "after" && parts.length >= 2) {
    let cur: unknown = form.afterJson;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as Record<string, unknown>)?.[parts[i]];
    return cur as string | number | string[] | ScheduleWindow[] | undefined | null;
  }
  if (parts[0] === "inputs" && parts.length >= 2) {
    let cur: unknown = form.inputsJson;
    for (let i = 1; i < parts.length && cur != null; i++) cur = (cur as Record<string, unknown>)?.[parts[i]];
    return cur as string | number | string[] | ScheduleWindow[] | undefined | null;
  }
  return undefined;
}

function setNested(obj: Record<string, unknown>, pathParts: string[], value: unknown): Record<string, unknown> {
  if (pathParts.length === 0) return obj;
  if (pathParts.length === 1) return { ...obj, [pathParts[0]]: value };
  const [head, ...tail] = pathParts;
  const child = (obj[head] && typeof obj[head] === "object" && !Array.isArray(obj[head]))
    ? (obj[head] as Record<string, unknown>)
    : {};
  return { ...obj, [head]: setNested({ ...child }, tail, value) };
}

function setByPath(
  prev: FormState,
  path: string,
  value: string | number | string[] | ScheduleWindow[] | null | undefined
): FormState {
  if (path === "quantity") return { ...prev, quantity: value === undefined || value === null ? "" : String(value) };
  if (path === "units") return { ...prev, units: value === undefined || value === null ? "" : String(value) };
  const parts = path.split(".");
  if (parts[0] === "before" && parts.length >= 2) {
    const key = parts[1];
    const rest = parts.slice(2);
    const base = (prev.beforeJson[key] as Record<string, unknown>) ?? {};
    const nextVal = rest.length === 0 ? value as unknown : setNested(base, rest, value);
    const nextBefore = { ...prev.beforeJson };
    if (nextVal === undefined || nextVal === null) delete nextBefore[key];
    else nextBefore[key] = nextVal;
    return { ...prev, beforeJson: nextBefore };
  }
  if (parts[0] === "after" && parts.length >= 2) {
    const key = parts[1];
    const rest = parts.slice(2);
    const base = (prev.afterJson[key] as Record<string, unknown>) ?? {};
    const nextVal = rest.length === 0 ? value as unknown : setNested(base, rest, value);
    const nextAfter = { ...prev.afterJson };
    if (nextVal === undefined || nextVal === null) delete nextAfter[key];
    else nextAfter[key] = nextVal;
    return { ...prev, afterJson: nextAfter };
  }
  if (parts[0] === "inputs" && parts.length >= 2) {
    const key = parts[1];
    const rest = parts.slice(2);
    const base = (prev.inputsJson[key] as Record<string, unknown>) ?? {};
    const nextVal = rest.length === 0 ? value as unknown : setNested(base, rest, value);
    const nextInputs = { ...prev.inputsJson };
    if (nextVal === undefined || nextVal === null) delete nextInputs[key];
    else nextInputs[key] = nextVal;
    return { ...prev, inputsJson: nextInputs };
  }
  return prev;
}

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function requiredPathsSatisfied(form: FormState, template: UpgradeTemplate): boolean {
  for (const path of template.requiredPaths) {
    const val = getByPath(form, path);
    if (path === "quantity" && template.requiresQuantity) {
      if (form.quantity === "" || !Number.isFinite(Number(form.quantity))) return false;
      continue;
    }
    if (path === "units" && template.requiresQuantity) {
      if (!form.units.trim()) return false;
      continue;
    }
    if (!isPresent(val)) return false;
  }
  return true;
}

const emptyForm = (
  canonicalEndMonth: string
): FormState => ({
  changeType: "ADD",
  upgradeType: "",
  effectiveDate: canonicalEndMonth + "-01",
  effectiveEndDate: "",
  quantity: "",
  units: "",
  notes: "",
  beforeJson: {},
  afterJson: {},
  inputsJson: {},
});

function formFromRow(row: LedgerRow, canonicalEndMonth: string): FormState {
  return {
    changeType: (row.changeType as ChangeType) || "ADD",
    upgradeType: row.upgradeType || "",
    effectiveDate: row.effectiveDate ?? canonicalEndMonth + "-01",
    effectiveEndDate: row.effectiveEndDate ?? "",
    quantity: row.quantity != null ? String(row.quantity) : "",
    units: row.units ?? "",
    notes: row.notes ?? "",
    beforeJson: (row.beforeJson && typeof row.beforeJson === "object" ? row.beforeJson : {}) as Record<string, unknown>,
    afterJson: (row.afterJson && typeof row.afterJson === "object" ? row.afterJson : {}) as Record<string, unknown>,
    inputsJson: (row.inputsJson && typeof row.inputsJson === "object" ? row.inputsJson : {}) as Record<string, unknown>,
  };
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (v: string | number | string[] | ScheduleWindow[] | null) => void;
  disabled?: boolean;
}) {
  const path = field.path;
  const opts = field.options ?? [];
  if (field.type === "timeRangeList") {
    const windows = (Array.isArray(value) ? value : []) as ScheduleWindow[];
    return (
      <TimeRangeList
        value={windows}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        label={field.label}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy w-full"
      >
        <option value="">Select…</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt];
      onChange(next);
    };
    return (
      <div className="flex flex-wrap gap-1">
        {(opts).map((o) => (
          <label key={o} className="flex items-center gap-1 text-xs text-brand-navy">
            <input
              type="checkbox"
              checked={arr.includes(o)}
              onChange={() => toggle(o)}
              disabled={disabled}
              className="rounded border-brand-blue/30"
            />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "number" || field.type === "percent") {
    const numVal = typeof value === "number" ? value : value === "" || value === undefined || value === null ? "" : Number(value);
    return (
      <input
        type="number"
        value={numVal === "" ? "" : numVal}
        onChange={(e) => {
          const s = e.target.value.trim();
          onChange(s === "" ? null : Number(s));
        }}
        disabled={disabled}
        min={field.type === "percent" ? 0 : undefined}
        max={field.type === "percent" ? 100 : undefined}
        step={field.type === "percent" ? 1 : undefined}
        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy w-full"
      />
    );
  }
  if (field.type === "date") {
    const s = typeof value === "string" ? value : value != null ? String(value) : "";
    return (
      <input
        type="date"
        value={s}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy w-full"
      />
    );
  }
  if (field.type === "boolean") {
    const checked = value === true || value === "YES" || value === "true";
    return (
      <label className="flex items-center gap-1 text-xs text-brand-navy">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? "YES" : "NO")}
          disabled={disabled}
          className="rounded border-brand-blue/30"
        />
        {field.label}
      </label>
    );
  }
  // text / time default
  const s = value === undefined || value === null ? "" : String(value);
  return (
    <input
      type={field.type === "time" ? "time" : "text"}
      value={s}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy w-full"
    />
  );
}

export function ScenarioUpgradesEditor({
  houseId,
  scenarioId,
  canonicalEndMonth = new Date().toISOString().slice(0, 7),
  onRecalc,
}: ScenarioUpgradesEditorProps) {
  const defaultDate = canonicalEndMonth + "-01";
  const [list, setList] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultDate));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/user/upgrades-ledger?houseId=${encodeURIComponent(houseId)}&scenarioId=${encodeURIComponent(scenarioId)}`
      );
      const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: LedgerRow[] };
      if (j?.ok && Array.isArray(j.data)) setList(j.data);
      else setList([]);
    } finally {
      setLoading(false);
    }
  }, [houseId, scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  const template = form.upgradeType ? getTemplateByKey(form.upgradeType) : null;
  const canSave =
    form.effectiveDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate) &&
    form.upgradeType.trim() &&
    template &&
    requiredPathsSatisfied(form, template);

  async function createLedgerAndEvent() {
    if (!canSave || !template) return;
    setAdding(true);
    try {
      const beforeJson = { ...form.beforeJson };
      const afterJson = { ...form.afterJson };
      const inputsJson = { ...form.inputsJson };
      const quantity = form.quantity.trim() ? Number(form.quantity) : undefined;
      const units = form.units.trim() || (template.defaultUnits ?? undefined);
      const payload = {
        houseId,
        scenarioId,
        upgradeType: form.upgradeType.trim(),
        changeType: form.changeType,
        quantity,
        units,
        effectiveDate: form.effectiveDate,
        effectiveEndDate: form.effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveEndDate) ? form.effectiveEndDate : undefined,
        beforeJson,
        afterJson,
        inputsJson,
        notes: form.notes.trim() || undefined,
        source: "USER",
      };
      const createRes = await fetch("/api/user/upgrades-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const createJson = (await createRes.json().catch(() => null)) as { ok?: boolean; data?: { id?: string } };
      if (!createRes.ok || !createJson?.ok || !createJson?.data?.id) {
        setAdding(false);
        return;
      }
      const ledgerId = createJson.data!.id;
      const eventRes = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          kind: "UPGRADE_ACTION",
          effectiveDate: form.effectiveDate,
          effectiveEndDate: form.effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveEndDate) ? form.effectiveEndDate : undefined,
          ledgerId,
          upgradeType: form.upgradeType.trim(),
          changeType: form.changeType,
          quantity: quantity ?? null,
          units: units ?? "",
          before: beforeJson,
          after: afterJson,
          inputs: inputsJson,
          notes: form.notes.trim() || "",
        }),
      });
      const eventJson = (await eventRes.json().catch(() => null)) as { ok?: boolean; event?: { id?: string } } | null;
      const eventPayload = eventJson && typeof eventJson === "object" && eventJson.event;
      if (!eventRes.ok || !eventPayload) {
        setAdding(false);
        await load();
        return;
      }
      const eventId = eventPayload.id;
      if (!eventId) {
        setAdding(false);
        await load();
        return;
      }
      await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(ledgerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioEventId: eventId, scenarioId }),
      });
      setForm(emptyForm(defaultDate));
      await load();
      onRecalc?.();
    } finally {
      setAdding(false);
    }
  }

  async function updateLedgerAndEvent(row: LedgerRow) {
    if (!template) return;
    setUpdateError(null);
    const beforeJson = { ...form.beforeJson };
    const afterJson = { ...form.afterJson };
    const inputsJson = { ...form.inputsJson };
    const quantity = form.quantity.trim() ? Number(form.quantity) : null;
    const units = form.units.trim() || (template.defaultUnits ?? undefined);
    const payload = {
      upgradeType: form.upgradeType.trim(),
      changeType: form.changeType,
      quantity,
      units,
      effectiveDate: form.effectiveDate,
      effectiveEndDate: form.effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveEndDate) ? form.effectiveEndDate : null,
      beforeJson,
      afterJson,
      inputsJson,
      notes: form.notes.trim() || null,
    };
    const ledgerRes = await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!ledgerRes.ok) {
      setUpdateError("Save failed. Please try again.");
      return;
    }
    if (row.scenarioEventId) {
      const eventRes = await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(row.scenarioEventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          payloadJson: {
            ledgerId: row.id,
            upgradeType: form.upgradeType.trim(),
            changeType: form.changeType,
            quantity,
            units,
            effectiveDate: form.effectiveDate,
            effectiveEndDate: form.effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveEndDate) ? form.effectiveEndDate : null,
            before: beforeJson,
            after: afterJson,
            inputs: inputsJson,
            notes: form.notes.trim() || "",
          },
          effectiveMonth: form.effectiveDate.slice(0, 7),
        }),
      });
      if (!eventRes.ok) {
        setUpdateError("Save failed. Please try again.");
        return;
      }
    }
    setEditingId(null);
    await load();
    onRecalc?.();
  }

  async function deleteLedgerAndEvent(row: LedgerRow) {
    await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(row.id)}`, { method: "DELETE" });
    if (row.scenarioEventId) {
      await fetch(
        `/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(row.scenarioEventId)}?houseId=${encodeURIComponent(houseId)}`,
        { method: "DELETE" }
      );
    }
    await load();
    onRecalc?.();
  }

  const labelForUpgradeType = (key: string) => {
    for (const g of UPGRADE_CATALOG_GROUPS) {
      const t = g.types.find((x) => x.key === key);
      if (t) return t.label;
    }
    return key;
  };

  if (loading) return <div className="text-sm text-brand-navy/70">Loading upgrades…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-blue/10 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Upgrades</div>
        <div className="mt-2 text-xs text-brand-navy/70">
          Add or edit upgrade actions (e.g. HVAC replacement, LED lighting). Each has an effective date and template-driven fields.
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-7">
            <select
              value={form.changeType}
              onChange={(e) => setForm((f) => ({ ...f, changeType: e.target.value as ChangeType }))}
              className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            >
              {CHANGE_TYPES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={form.upgradeType}
              onChange={(e) => {
                const key = e.target.value;
                const t = key ? getTemplateByKey(key) : null;
                setForm((prev) => ({
                  ...emptyForm(defaultDate),
                  changeType: prev.changeType,
                  upgradeType: key,
                  effectiveDate: prev.effectiveDate || defaultDate,
                  effectiveEndDate: prev.effectiveEndDate,
                  quantity: t?.requiresQuantity ? "" : prev.quantity,
                  units: t?.defaultUnits ?? prev.units,
                }));
              }}
              className="md:col-span-2 rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            >
              <option value="">Select type…</option>
              {UPGRADE_CATALOG_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              type="date"
              value={form.effectiveDate}
              onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            />
            <input
              type="date"
              value={form.effectiveEndDate}
              onChange={(e) => setForm((f) => ({ ...f, effectiveEndDate: e.target.value }))}
              placeholder="End (optional)"
              className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            />
            {(template?.requiresQuantity ?? false) && (
              <>
                <input
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="Qty"
                  className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
                />
                <input
                  value={form.units}
                  onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
                  placeholder={template?.defaultUnits ?? "Units"}
                  className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
                />
              </>
            )}
          </div>

          {template && template.fields.length > 0 && (
            <div className="rounded-xl border border-brand-blue/10 bg-brand-blue/5 p-3 space-y-3">
              <div className="text-xs font-medium text-brand-navy/80">Details</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {template.fields
                  .filter((fd) => fd.path !== "quantity" && fd.path !== "units")
                  .map((fd) => (
                    <div key={fd.path} className="space-y-1">
                      <label className="block text-xs text-brand-navy/70">
                        {fd.label}
                        {fd.required && <span className="text-red-600 ml-0.5">*</span>}
                      </label>
                      <FieldInput
                        field={fd}
                        value={getByPath(form, fd.path)}
                        onChange={(v) => setForm((prev) => setByPath(prev, fd.path, v))}
                        disabled={adding}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Notes"
              className="flex-1 min-w-[120px] rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
            />
            <button
              type="button"
              disabled={adding || !canSave}
              onClick={() => void createLedgerAndEvent()}
              className="rounded-xl border border-brand-blue/30 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add upgrade"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-blue/10 bg-brand-blue/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Upgrade actions</div>
        <div className="mt-3 space-y-2">
          {list.length === 0 && <div className="text-sm text-brand-navy/70">No upgrade actions yet.</div>}
          {[...list].sort((a, b) => (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? "")).map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-brand-blue/10 bg-white p-3 space-y-2"
            >
              {editingId === row.id ? (
                <>
                  <div className="grid gap-2 md:grid-cols-7">
                    <select
                      value={form.changeType}
                      onChange={(e) => setForm((f) => ({ ...f, changeType: e.target.value as ChangeType }))}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    >
                      {CHANGE_TYPES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      value={form.upgradeType}
                      onChange={(e) => {
                        const key = e.target.value;
                        const t = key ? getTemplateByKey(key) : null;
                        setForm((prev) => ({
                          ...prev,
                          upgradeType: key,
                          quantity: t?.requiresQuantity ? prev.quantity : prev.quantity,
                          units: t?.defaultUnits ?? prev.units,
                        }));
                      }}
                      className="md:col-span-2 rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    >
                      {UPGRADE_CATALOG_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.types.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={form.effectiveDate}
                      onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    />
                    <input
                      type="date"
                      value={form.effectiveEndDate}
                      onChange={(e) => setForm((f) => ({ ...f, effectiveEndDate: e.target.value }))}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    />
                    {getTemplateByKey(form.upgradeType)?.requiresQuantity && (
                      <>
                        <input
                          value={form.quantity}
                          onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                          placeholder="Qty"
                          className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                        />
                        <input
                          value={form.units}
                          onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
                          placeholder="Units"
                          className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                        />
                      </>
                    )}
                  </div>
                  {template && (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {template.fields
                        .filter((fd) => fd.path !== "quantity" && fd.path !== "units")
                        .map((fd) => (
                          <div key={fd.path} className="space-y-1">
                            <label className="block text-xs text-brand-navy/70">{fd.label}</label>
                            <FieldInput
                              field={fd}
                              value={getByPath(form, fd.path)}
                              onChange={(v) => setForm((prev) => setByPath(prev, fd.path, v))}
                            />
                          </div>
                        ))}
                    </div>
                  )}
                  {updateError && (
                    <div className="text-xs text-red-600" role="alert">
                      {updateError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void updateLedgerAndEvent(row)}
                      disabled={!template || !requiredPathsSatisfied(form, template)}
                      className="rounded-lg border border-brand-blue/30 bg-white px-2 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setUpdateError(null); setEditingId(null); }}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs font-semibold text-brand-navy"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteLedgerAndEvent(row)}
                      className="rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-brand-navy">
                      {row.changeType} · {labelForUpgradeType(row.upgradeType)}
                    </span>
                    <span className="text-xs text-brand-navy/70">{row.effectiveDate ?? "—"}</span>
                    <span className="text-xs text-brand-navy/70">{row.effectiveEndDate ?? "—"}</span>
                    {(row.quantity != null || row.units) && (
                      <span className="text-xs text-brand-navy/70">
                        {row.quantity != null ? row.quantity : ""} {row.units ?? ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUpdateError(null);
                        setForm(formFromRow(row, defaultDate));
                        setEditingId(row.id);
                      }}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs font-semibold text-brand-navy"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteLedgerAndEvent(row)}
                      className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}