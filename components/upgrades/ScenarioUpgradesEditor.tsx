"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UPGRADE_CATALOG_GROUPS,
  CHANGE_TYPES,
  type ChangeType,
} from "@/components/upgrades/catalog";

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
};

type ScenarioUpgradesEditorProps = {
  houseId: string;
  scenarioId: string;
  canonicalEndMonth?: string;
  onRecalc?: () => void;
};

export function ScenarioUpgradesEditor({
  houseId,
  scenarioId,
  canonicalEndMonth = new Date().toISOString().slice(0, 7),
  onRecalc,
}: ScenarioUpgradesEditorProps) {
  const [list, setList] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    changeType: "ADD" as ChangeType,
    upgradeType: "",
    effectiveDate: canonicalEndMonth + "-01",
    effectiveEndDate: "",
    quantity: "",
    units: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/user/upgrades-ledger?houseId=${encodeURIComponent(houseId)}&scenarioId=${encodeURIComponent(scenarioId)}`
      );
      const j = (await r.json().catch(() => null)) as any;
      if (j?.ok && Array.isArray(j.data)) setList(j.data);
      else setList([]);
    } finally {
      setLoading(false);
    }
  }, [houseId, scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLedgerAndEvent() {
    if (!form.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) return;
    if (!form.upgradeType.trim()) return;
    setAdding(true);
    try {
      const createRes = await fetch("/api/user/upgrades-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          scenarioId,
          upgradeType: form.upgradeType.trim(),
          changeType: form.changeType,
          quantity: form.quantity.trim() ? Number(form.quantity) : undefined,
          units: form.units.trim() || undefined,
          effectiveDate: form.effectiveDate,
          effectiveEndDate: form.effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveEndDate) ? form.effectiveEndDate : undefined,
          notes: form.notes.trim() || undefined,
          source: "USER",
        }),
      });
      const createJson = (await createRes.json().catch(() => null)) as any;
      if (!createRes.ok || !createJson?.ok || !createJson?.data?.id) {
        setAdding(false);
        return;
      }
      const ledgerId = createJson.data.id;
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
          quantity: form.quantity.trim() ? Number(form.quantity) : 0,
          units: form.units.trim() || "",
          before: {},
          after: {},
          inputs: {},
          notes: form.notes.trim() || "",
        }),
      });
      const eventJson = (await eventRes.json().catch(() => null)) as any;
      if (!eventRes.ok || !eventJson?.ok?.event) {
        setAdding(false);
        await load();
        return;
      }
      const eventId = eventJson.event.id;
      await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(ledgerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioEventId: eventId }),
      });
      setForm({
        changeType: "ADD",
        upgradeType: "",
        effectiveDate: canonicalEndMonth + "-01",
        effectiveEndDate: "",
        quantity: "",
        units: "",
        notes: "",
      });
      await load();
      onRecalc?.();
    } finally {
      setAdding(false);
    }
  }

  async function updateLedgerAndEvent(row: LedgerRow, patch: Partial<LedgerRow> & { effectiveDate?: string; effectiveEndDate?: string }) {
    const eventId = row.scenarioEventId;
    await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upgradeType: patch.upgradeType,
        changeType: patch.changeType,
        quantity: patch.quantity,
        units: patch.units,
        effectiveDate: patch.effectiveDate,
        effectiveEndDate: patch.effectiveEndDate,
        notes: patch.notes,
      }),
    });
    if (eventId && (patch.effectiveDate !== undefined || patch.effectiveEndDate !== undefined || patch.upgradeType !== undefined || patch.changeType !== undefined || patch.quantity !== undefined || patch.units !== undefined || patch.notes !== undefined)) {
      await fetch(`/api/user/simulator/scenarios/${encodeURIComponent(scenarioId)}/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          houseId,
          payloadJson: {
            ledgerId: row.id,
            upgradeType: patch.upgradeType ?? row.upgradeType,
            changeType: patch.changeType ?? row.changeType,
            quantity: patch.quantity ?? row.quantity ?? 0,
            units: patch.units ?? row.units ?? "",
            effectiveDate: patch.effectiveDate ?? row.effectiveDate ?? "",
            effectiveEndDate: patch.effectiveEndDate !== undefined ? patch.effectiveEndDate : row.effectiveEndDate,
            before: {},
            after: {},
            inputs: {},
            notes: patch.notes ?? row.notes ?? "",
          },
          effectiveMonth: patch.effectiveDate ? patch.effectiveDate.slice(0, 7) : undefined,
        }),
      });
    }
    setEditingId(null);
    await load();
    onRecalc?.();
  }

  async function deleteLedgerAndEvent(row: LedgerRow) {
    if (!row.scenarioEventId) {
      await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(row.id)}`, { method: "DELETE" });
    } else {
      await fetch(`/api/user/upgrades-ledger/${encodeURIComponent(row.id)}`, { method: "DELETE" });
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
          Add or edit upgrade actions (e.g. HVAC replacement, LED lighting). Each has an effective date on the timeline.
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-7">
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
            onChange={(e) => setForm((f) => ({ ...f, upgradeType: e.target.value }))}
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
          <input
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            placeholder="Qty"
            className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
          />
          <input
            value={form.units}
            onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
            placeholder="Units"
            className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
          />
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes"
            className="flex-1 rounded-lg border border-brand-blue/20 bg-white px-2 py-1.5 text-xs text-brand-navy"
          />
          <button
            type="button"
            disabled={adding || !form.effectiveDate || !form.upgradeType.trim()}
            onClick={() => void createLedgerAndEvent()}
            className="rounded-xl border border-brand-blue/30 bg-white px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add upgrade"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-blue/10 bg-brand-blue/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-navy/60">Upgrade actions</div>
        <div className="mt-3 space-y-2">
          {list.length === 0 && <div className="text-sm text-brand-navy/70">No upgrade actions yet.</div>}
          {list.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-xl border border-brand-blue/10 bg-white p-3 md:grid-cols-8 items-center"
            >
              {editingId === row.id ? (
                <>
                  <select
                    defaultValue={row.changeType}
                    onBlur={(e) => updateLedgerAndEvent(row, { changeType: e.target.value as ChangeType })}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                  >
                    {CHANGE_TYPES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    defaultValue={row.upgradeType}
                    onBlur={(e) => updateLedgerAndEvent(row, { upgradeType: e.target.value })}
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
                    defaultValue={row.effectiveDate ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v) updateLedgerAndEvent(row, { effectiveDate: v });
                    }}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                  />
                  <input
                    type="date"
                    defaultValue={row.effectiveEndDate ?? ""}
                    onBlur={(e) => updateLedgerAndEvent(row, { effectiveEndDate: e.target.value || undefined })}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                  />
                  <input
                    defaultValue={row.quantity ?? ""}
                    onBlur={(e) => {
                      const s = e.target.value.trim();
                      updateLedgerAndEvent(row, { quantity: s ? Number(s) : null });
                    }}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    placeholder="Qty"
                  />
                  <input
                    defaultValue={row.units ?? ""}
                    onBlur={(e) => updateLedgerAndEvent(row, { units: e.target.value || null })}
                    className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs text-brand-navy"
                    placeholder="Units"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-brand-blue/20 bg-white px-2 py-1 text-xs font-semibold text-brand-navy"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteLedgerAndEvent(row)}
                      className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium text-brand-navy md:col-span-2">
                    {row.changeType} · {labelForUpgradeType(row.upgradeType)}
                  </span>
                  <span className="text-xs text-brand-navy/70">{row.effectiveDate ?? "—"}</span>
                  <span className="text-xs text-brand-navy/70">{row.effectiveEndDate ?? "—"}</span>
                  <span className="text-xs text-brand-navy/70">{row.quantity != null ? row.quantity : "—"}</span>
                  <span className="text-xs text-brand-navy/70">{row.units ?? "—"}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(row.id)}
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
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
