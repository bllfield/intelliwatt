"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatAdminToolErrorMessage } from "@/lib/admin/formatAdminToolError";
import {
  MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID,
  MANUAL_GAPFILL_DEFAULT_MODE,
  MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID,
  MANUAL_GAPFILL_DEFAULT_USER_EMAIL,
  buildManualGapfillIdentityKey,
  fetchAdminUserByEmail,
  extractArtifactInputHashFromRunResult,
  extractSeedHashFromPrepareResult,
  extractSourceIntervalFingerprint,
  extractValidationPolicyHashFromContext,
  fetchManualGapfillCompare,
  fetchManualGapfillPrepareSeed,
  fetchManualGapfillRunReadback,
  fetchManualGapfillSourceContext,
  fetchValidationDayPolicyPreview,
  fetchValidationDayPolicySnapshot,
  sameHouseBlocked,
  type ManualGapfillSeedMode,
} from "@/lib/admin/manualGapfillClient";
import {
  Field,
  FieldGrid,
  JsonDetails,
  StepSection,
  WarningsList,
} from "@/components/admin/manual-gapfill/StepSection";

type StepState<T> = {
  identityKey: string;
  data: T;
} | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function ManualGapfillAdmin() {
  const [userEmail, setUserEmail] = useState(MANUAL_GAPFILL_DEFAULT_USER_EMAIL);
  const [userId, setUserId] = useState("");
  const [userLookupNote, setUserLookupNote] = useState<string | null>(null);
  const [sourceHouseId, setSourceHouseId] = useState(MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID);
  const [labHouseId, setLabHouseId] = useState(MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID);
  const [mode, setMode] = useState<ManualGapfillSeedMode>(MANUAL_GAPFILL_DEFAULT_MODE);
  const [esiid, setEsiid] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [anchorEndDate, setAnchorEndDate] = useState("");
  const [includeDailyRows, setIncludeDailyRows] = useState(false);
  const [persistSeedToggle, setPersistSeedToggle] = useState(false);

  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);

  const [policySnapshot, setPolicySnapshot] = useState<Record<string, unknown> | null>(null);
  const [step1, setStep1] = useState<StepState<Record<string, unknown>> | null>(null);
  const [step2Preview, setStep2Preview] = useState<StepState<Record<string, unknown>> | null>(null);
  const [step3, setStep3] = useState<StepState<Record<string, unknown>> | null>(null);
  const [step4, setStep4] = useState<StepState<Record<string, unknown>> | null>(null);
  const [step5, setStep5] = useState<StepState<Record<string, unknown>> | null>(null);

  const identityKey = useMemo(
    () =>
      buildManualGapfillIdentityKey({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
      }),
    [userId, sourceHouseId, labHouseId, mode]
  );

  const sourceContext = step1?.data ?? null;
  const prepareResult = step3?.data ?? null;
  const runResult = step4?.data ?? null;
  const compareResult = step5?.data ?? null;

  const expectedSourceFingerprint = extractSourceIntervalFingerprint(sourceContext);
  const expectedValidationDayPolicyHash =
    asString(step2Preview?.data?.policyHash) ??
    extractValidationPolicyHashFromContext(sourceContext) ??
    asString(policySnapshot?.policyHash);
  const expectedSeedHash = extractSeedHashFromPrepareResult(prepareResult);
  const expectedArtifactInputHash = extractArtifactInputHashFromRunResult(runResult);

  const isStale = useCallback((step: StepState<unknown> | null) => {
    return Boolean(step && step.identityKey !== identityKey);
  }, [identityKey]);

  const previousIdentityKey = useRef(identityKey);
  useEffect(() => {
    if (previousIdentityKey.current === identityKey) return;
    previousIdentityKey.current = identityKey;
    setStep1(null);
    setStep2Preview(null);
    setStep3(null);
    setStep4(null);
    setStep5(null);
    setIdentityNotice("Source/lab/mode changed — downstream step results were cleared. Re-run from Step 1.");
  }, [identityKey]);

  useEffect(() => {
    void (async () => {
      const res = await fetchValidationDayPolicySnapshot();
      if (res.ok) setPolicySnapshot(res.data);
    })();
  }, []);

  useEffect(() => {
    const email = userEmail.trim();
    if (!email) {
      setUserId("");
      setUserLookupNote(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetchAdminUserByEmail(email);
      if (cancelled) return;
      if (!res.ok) {
        setUserId("");
        setUserLookupNote(res.error);
        return;
      }
      setUserId(res.data.userId);
      setUserLookupNote(`Resolved user ID for ${res.data.email}`);
      const sourceHouse = res.data.houses?.find((house) => house.id === sourceHouseId.trim());
      if (sourceHouse?.esiid) {
        setEsiid((current) => current.trim() || sourceHouse.esiid || "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userEmail, sourceHouseId]);

  const requireIdentity = useCallback(() => {
    if (!userEmail.trim()) {
      setError("User email is required for Manual GapFill admin calls.");
      return false;
    }
    if (!userId.trim()) {
      setError("Could not resolve user ID from email. Check the email or your admin session.");
      return false;
    }
    if (!sourceHouseId.trim() || !labHouseId.trim()) {
      setError("Source house ID and lab house ID are required.");
      return false;
    }
    if (sameHouseBlocked(sourceHouseId, labHouseId)) {
      setError("Lab house ID must differ from source house ID.");
      return false;
    }
    return true;
  }, [userEmail, userId, sourceHouseId, labHouseId]);

  const runStep1 = useCallback(async () => {
    if (!requireIdentity()) return;
    setBusyStep("step1");
    setError(null);
    setStatus(null);
    try {
      const res = await fetchManualGapfillSourceContext({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        esiid: esiid.trim() || undefined,
        includeDiagnostics,
      });
      if (!res.ok) {
        setError(res.error);
        setStep1(null);
        return;
      }
      const context = asRecord(res.data.context);
      setStep1({ identityKey, data: context ?? {} });
      setStatus("Source context loaded.");
    } catch (err) {
      setError(formatAdminToolErrorMessage(err));
      setStep1(null);
    } finally {
      setBusyStep(null);
    }
  }, [requireIdentity, userId, sourceHouseId, esiid, includeDiagnostics, identityKey]);

  const runStep2Preview = useCallback(async () => {
    if (!requireIdentity()) return;
    setBusyStep("step2");
    setError(null);
    setStatus(null);
    try {
      const res = await fetchValidationDayPolicyPreview({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        esiid: esiid.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        setStep2Preview(null);
        return;
      }
      setStep2Preview({ identityKey, data: res.data });
      const keys = Array.isArray(res.data.selectedValidationDateKeys) ? res.data.selectedValidationDateKeys.length : 0;
      setStatus(`Validation policy preview selected ${keys} days.`);
    } catch (err) {
      setError(formatAdminToolErrorMessage(err));
      setStep2Preview(null);
    } finally {
      setBusyStep(null);
    }
  }, [requireIdentity, userId, sourceHouseId, esiid, identityKey]);

  const runStep3 = useCallback(
    async (persistToLabHome: boolean) => {
      if (!requireIdentity()) return;
      if (persistToLabHome && !persistSeedToggle) {
        setError("Enable “Persist seed to lab home” before using the persist action.");
        return;
      }
      setBusyStep(persistToLabHome ? "step3-persist" : "step3-dry");
      setError(null);
      setStatus(null);
      try {
        const res = await fetchManualGapfillPrepareSeed({
          userId: userId.trim(),
          sourceHouseId: sourceHouseId.trim(),
          labHouseId: labHouseId.trim(),
          mode,
          persistToLabHome,
          esiid: esiid.trim() || undefined,
          anchorEndDate: anchorEndDate.trim() || undefined,
          includeDiagnostics,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const result = asRecord(res.data.result) ?? {};
        setStep3({ identityKey, data: result });
        setStatus(
          persistToLabHome
            ? "Seed prepared and persisted to lab home."
            : "Dry run — seed prepared without writing to lab home."
        );
      } catch (err) {
        setError(formatAdminToolErrorMessage(err));
      } finally {
        setBusyStep(null);
      }
    },
    [
      requireIdentity,
      persistSeedToggle,
      userId,
      sourceHouseId,
      labHouseId,
      mode,
      esiid,
      anchorEndDate,
      includeDiagnostics,
      identityKey,
    ]
  );

  const runStep4 = useCallback(async () => {
    if (!requireIdentity()) return;
    setBusyStep("step4");
    setError(null);
    setStatus(null);
    try {
      const res = await fetchManualGapfillRunReadback({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
        esiid: esiid.trim() || undefined,
        expectedSeedHash: expectedSeedHash ?? undefined,
        expectedSourceFingerprint: expectedSourceFingerprint ?? undefined,
        expectedValidationDayPolicyHash: expectedValidationDayPolicyHash ?? undefined,
        persistRequested: true,
      });
      if (!res.ok) {
        setError(res.error);
        const failed = asRecord(asRecord(res.raw)?.result);
        if (failed) setStep4({ identityKey, data: failed });
        return;
      }
      const result = asRecord(res.data.result) ?? {};
      setStep4({ identityKey, data: result });
      setStatus("Run Past Sim on lab home completed; readback loaded.");
    } catch (err) {
      setError(formatAdminToolErrorMessage(err));
    } finally {
      setBusyStep(null);
    }
  }, [
    requireIdentity,
    userId,
    sourceHouseId,
    labHouseId,
    mode,
    esiid,
    expectedSeedHash,
    expectedSourceFingerprint,
    expectedValidationDayPolicyHash,
    identityKey,
  ]);

  const runStep5 = useCallback(async () => {
    if (!requireIdentity()) return;
    setBusyStep("step5");
    setError(null);
    setStatus(null);
    try {
      const res = await fetchManualGapfillCompare({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
        includeDailyRows,
        esiid: esiid.trim() || undefined,
        expectedSeedHash: expectedSeedHash ?? undefined,
        expectedSourceFingerprint: expectedSourceFingerprint ?? undefined,
        expectedValidationDayPolicyHash: expectedValidationDayPolicyHash ?? undefined,
        expectedArtifactInputHash: expectedArtifactInputHash ?? undefined,
      });
      if (!res.ok) {
        setError(res.error);
        const failed = asRecord(asRecord(res.raw)?.result);
        if (failed) setStep5({ identityKey, data: failed });
        return;
      }
      const result = asRecord(res.data.result) ?? {};
      setStep5({ identityKey, data: result });
      setStatus("Compare source actual vs lab simulated completed.");
    } catch (err) {
      setError(formatAdminToolErrorMessage(err));
    } finally {
      setBusyStep(null);
    }
  }, [
    requireIdentity,
    userId,
    sourceHouseId,
    labHouseId,
    mode,
    includeDailyRows,
    esiid,
    expectedSeedHash,
    expectedSourceFingerprint,
    expectedValidationDayPolicyHash,
    expectedArtifactInputHash,
    identityKey,
  ]);

  const runPipeline = useCallback(async () => {
    if (!requireIdentity()) return;
    setIdentityNotice(null);
    setBusyStep("pipeline");
    setError(null);
    try {
      const s1 = await fetchManualGapfillSourceContext({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        esiid: esiid.trim() || undefined,
        includeDiagnostics,
      });
      if (!s1.ok) {
        setError(s1.error);
        return;
      }
      const ctx = asRecord(s1.data.context) ?? {};
      setStep1({ identityKey, data: ctx });

      const s2 = await fetchValidationDayPolicyPreview({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        esiid: esiid.trim() || undefined,
      });
      if (!s2.ok) {
        setError(s2.error);
        return;
      }
      setStep2Preview({ identityKey, data: s2.data });

      const s3 = await fetchManualGapfillPrepareSeed({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
        persistToLabHome: false,
        esiid: esiid.trim() || undefined,
        anchorEndDate: anchorEndDate.trim() || undefined,
        includeDiagnostics,
      });
      if (!s3.ok) {
        setError(s3.error);
        return;
      }
      const seedResult = asRecord(s3.data.result) ?? {};
      setStep3({ identityKey, data: seedResult });
      const seedHash = extractSeedHashFromPrepareResult(seedResult);
      const fp = extractSourceIntervalFingerprint(ctx);
      const policyHash =
        asString(s2.data.policyHash) ?? extractValidationPolicyHashFromContext(ctx) ?? undefined;

      const s4 = await fetchManualGapfillRunReadback({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
        esiid: esiid.trim() || undefined,
        expectedSeedHash: seedHash ?? undefined,
        expectedSourceFingerprint: fp ?? undefined,
        expectedValidationDayPolicyHash: policyHash,
        persistRequested: true,
      });
      if (!s4.ok) {
        setError(s4.error);
        const failed = asRecord(asRecord(s4.raw)?.result);
        if (failed) setStep4({ identityKey, data: failed });
        return;
      }
      const runRes = asRecord(s4.data.result) ?? {};
      setStep4({ identityKey, data: runRes });
      const artifactHash = extractArtifactInputHashFromRunResult(runRes);

      const s5 = await fetchManualGapfillCompare({
        userId: userId.trim(),
        sourceHouseId: sourceHouseId.trim(),
        labHouseId: labHouseId.trim(),
        mode,
        includeDailyRows,
        esiid: esiid.trim() || undefined,
        expectedSeedHash: seedHash ?? undefined,
        expectedSourceFingerprint: fp ?? undefined,
        expectedValidationDayPolicyHash: policyHash,
        expectedArtifactInputHash: artifactHash ?? undefined,
      });
      if (!s5.ok) {
        setError(s5.error);
        const failed = asRecord(asRecord(s5.raw)?.result);
        if (failed) setStep5({ identityKey, data: failed });
        return;
      }
      setStep5({ identityKey, data: asRecord(s5.data.result) ?? {} });
      setStatus("Pipeline completed (dry-run seed through compare). Persist seed separately if needed.");
    } catch (err) {
      setError(formatAdminToolErrorMessage(err));
    } finally {
      setBusyStep(null);
    }
  }, [
    requireIdentity,
    userId,
    sourceHouseId,
    labHouseId,
    mode,
    esiid,
    includeDiagnostics,
    anchorEndDate,
    includeDailyRows,
    identityKey,
  ]);

  const coverage = asRecord(sourceContext?.coverage);
  const fingerprints = asRecord(sourceContext?.fingerprints);
  const validation = asRecord(sourceContext?.validation);
  const diagnostics = asRecord(sourceContext?.diagnostics);
  const seed = asRecord(prepareResult?.seed);
  const labContext = asRecord(prepareResult?.labContext);
  const seedDiagnostics = asRecord(prepareResult?.diagnostics);
  const run = asRecord(runResult?.run);
  const readback = asRecord(runResult?.readback);
  const runDiagnostics = asRecord(runResult?.diagnostics);
  const compare = asRecord(compareResult?.compare);
  const sourceActual = asRecord(compareResult?.sourceActual);
  const labSimulated = asRecord(compareResult?.labSimulated);
  const compareDiagnostics = asRecord(compareResult?.diagnostics);
  const monthlyCompare = asRecord(compare?.monthly);
  const annualCompare = asRecord(compare?.annual);
  const dailySummary = asRecord(compare?.dailySummary);
  const dailyRows = Array.isArray(compare?.dailyRows) ? compare.dailyRows : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Manual GapFill</h1>
        <p className="mt-2 text-sm text-slate-600">
          Admin pipeline wiring for Manual GapFill (MG-1 → MG-5). Uses{" "}
          <strong>source actual usage</strong> on the source home and{" "}
          <strong>lab simulated usage</strong> on the lab home. This is separate from legacy GapFill;{" "}
          <code className="rounded bg-slate-100 px-1">EXACT_INTERVALS</code> is unchanged. MG-5 compare is an
          admin diagnostic only and does not change production Simulation Accuracy scoring.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {status ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {status}
        </div>
      ) : null}
      {identityNotice ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {identityNotice}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-brand-navy">Pipeline identity</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-semibold">User email (source house owner)</span>
            <input
              className="rounded border px-3 py-2"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder={MANUAL_GAPFILL_DEFAULT_USER_EMAIL}
            />
            {userId ? (
              <span className="text-xs text-slate-500">
                Resolved user ID: <span className="font-mono">{userId}</span>
              </span>
            ) : userLookupNote ? (
              <span className="text-xs text-amber-700">{userLookupNote}</span>
            ) : (
              <span className="text-xs text-slate-500">Resolving user ID…</span>
            )}
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Source house ID</span>
            <input
              className="rounded border px-3 py-2"
              value={sourceHouseId}
              onChange={(e) => setSourceHouseId(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Lab house ID</span>
            <input className="rounded border px-3 py-2" value={labHouseId} onChange={(e) => setLabHouseId(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Mode</span>
            <select
              className="rounded border px-3 py-2"
              value={mode}
              onChange={(e) => setMode(e.target.value as ManualGapfillSeedMode)}
            >
              <option value="MONTHLY_FROM_SOURCE_INTERVALS">MONTHLY_FROM_SOURCE_INTERVALS</option>
              <option value="ANNUAL_FROM_SOURCE_INTERVALS">ANNUAL_FROM_SOURCE_INTERVALS</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">ESIID (optional)</span>
            <input className="rounded border px-3 py-2" value={esiid} onChange={(e) => setEsiid(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
            />
            <span className="font-semibold">Include diagnostics (Steps 1 &amp; 3)</span>
          </label>
        </div>
        {sameHouseBlocked(sourceHouseId, labHouseId) ? (
          <p className="mt-3 text-sm font-semibold text-red-700">
            Source and lab house IDs must differ before running Manual GapFill.
          </p>
        ) : null}
        <button
          type="button"
          disabled={Boolean(busyStep) || sameHouseBlocked(sourceHouseId, labHouseId)}
          onClick={() => void runPipeline()}
          className="mt-4 rounded-lg border border-brand-navy px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
        >
          {busyStep === "pipeline" ? "Running pipeline…" : "Run pipeline (dry-run seed → readback → compare)"}
        </button>
      </section>

      <StepSection
        step={1}
        title="Source Context"
        description="Load source actual usage context from the source home."
        stale={isStale(step1)}
      >
        <button
          type="button"
          disabled={busyStep === "step1" || sameHouseBlocked(sourceHouseId, labHouseId)}
          onClick={() => void runStep1()}
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busyStep === "step1" ? "Loading…" : "Load source context"}
        </button>
        {sourceContext ? (
          <FieldGrid>
            <Field label="Source house ID" value={asString(sourceContext.sourceHouseId)} />
            <Field label="ESIID" value={asString(sourceContext.esiid)} />
            <Field label="Actual source kind" value={asString(sourceContext.actualSourceKind)} />
            <Field label="Status" value={asString(sourceContext.status)} />
            <Field label="Coverage start" value={asString(coverage?.coverageStart)} />
            <Field label="Coverage end" value={asString(coverage?.coverageEnd)} />
            <Field label="Daily count" value={asNumber(coverage?.dailyCount)} />
            <Field label="Interval count" value={asNumber(coverage?.intervalCount)} />
            <Field label="Monthly count" value={asNumber(coverage?.monthlyCount)} />
            <Field
              label="Annual total (source actual usage)"
              value={asNumber(asRecord(sourceContext.actualData)?.annualTotal)}
            />
            <Field label="Interval fingerprint" value={asString(fingerprints?.intervalFingerprint)} />
            <Field label="Daily fingerprint" value={asString(fingerprints?.dailyFingerprint)} />
            <Field label="Monthly fingerprint" value={asString(fingerprints?.monthlyFingerprint)} />
            <Field label="Validation policy revision" value={asString(validation?.activeValidationDayPolicyRevision)} />
            <Field label="Validation policy hash" value={asString(validation?.activeValidationDayPolicyHash)} />
          </FieldGrid>
        ) : null}
        <WarningsList warnings={Array.isArray(diagnostics?.warnings) ? (diagnostics.warnings as string[]) : undefined} />
        <JsonDetails label="Source context JSON" value={sourceContext} />
      </StepSection>

      <StepSection
        step={2}
        title="Validation Policy Preview"
        description="Global validation-day policy (MG-2). localGapFillSelectorUsed is always false."
        stale={isStale(step2Preview)}
      >
        <p className="text-sm text-slate-600">
          Full editor:{" "}
          <Link href="/admin/tools/validation-day-policy" className="text-brand-navy underline">
            /admin/tools/validation-day-policy
          </Link>
        </p>
        {policySnapshot ? (
          <FieldGrid>
            <Field label="Policy revision" value={asString(policySnapshot.policyRevision)} />
            <Field label="Policy layer" value={asString(policySnapshot.policyLayer)} />
            <Field label="Policy hash" value={asString(policySnapshot.policyHash)} />
            <Field label="localGapFillSelectorUsed" value="false" />
          </FieldGrid>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Loading policy snapshot…</p>
        )}
        <button
          type="button"
          disabled={busyStep === "step2" || sameHouseBlocked(sourceHouseId, labHouseId)}
          onClick={() => void runStep2Preview()}
          className="mt-3 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busyStep === "step2" ? "Previewing…" : "Preview validation days for source home"}
        </button>
        {step2Preview?.data ? (
          <FieldGrid>
            <Field label="Policy revision" value={asString(step2Preview.data.policyRevision)} />
            <Field label="Policy hash" value={asString(step2Preview.data.policyHash)} />
            <Field label="Selection mode" value={asString(step2Preview.data.selectionMode)} />
            <Field label="Validation day count" value={asNumber(step2Preview.data.validationDayCount)} />
            <Field
              label="Selected validation date keys"
              value={
                Array.isArray(step2Preview.data.selectedValidationDateKeys)
                  ? (step2Preview.data.selectedValidationDateKeys as string[]).join(", ")
                  : "—"
              }
            />
            <Field
              label="localGapFillSelectorUsed"
              value={String(asRecord(step2Preview.data.diagnostics)?.localGapFillSelectorUsed ?? false)}
            />
          </FieldGrid>
        ) : null}
        <WarningsList
          warnings={
            Array.isArray(step2Preview?.data?.warnings) ? (step2Preview.data.warnings as string[]) : undefined
          }
        />
      </StepSection>

      <StepSection
        step={3}
        title="Prepare Seed"
        description="Derive manual seed from source actual usage. Dry run is the default; persist only when explicitly enabled."
        stale={isStale(step3)}
      >
        <label className="grid max-w-md gap-1 text-sm">
          <span className="font-semibold">Anchor end date (optional)</span>
          <input
            className="rounded border px-3 py-2"
            value={anchorEndDate}
            onChange={(e) => setAnchorEndDate(e.target.value)}
            placeholder="YYYY-MM-DD"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={persistSeedToggle}
            onChange={(e) => setPersistSeedToggle(e.target.checked)}
          />
          <span className="font-semibold">Persist seed to lab home (explicit opt-in)</span>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(busyStep) || sameHouseBlocked(sourceHouseId, labHouseId)}
            onClick={() => void runStep3(false)}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busyStep === "step3-dry" ? "Preparing…" : "Dry run — Prepare seed"}
          </button>
          <button
            type="button"
            disabled={Boolean(busyStep) || !persistSeedToggle || sameHouseBlocked(sourceHouseId, labHouseId)}
            onClick={() => void runStep3(true)}
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
          >
            {busyStep === "step3-persist" ? "Persisting…" : "Persist seed to lab home"}
          </button>
        </div>
        {prepareResult ? (
          <FieldGrid>
            <Field label="Seed status" value={asString(prepareResult.status)} />
            <Field label="Seed hash" value={extractSeedHashFromPrepareResult(prepareResult)} />
            <Field label="Manual usage mode" value={asString(seed?.manualUsageMode)} />
            <Field label="Total kWh" value={asNumber(seed?.totalKwh)} />
            <Field label="Bill period count" value={asNumber(seed?.billPeriodCount)} />
            <Field label="Annual total kWh" value={asNumber(seed?.annualTotalKwh)} />
            <Field label="Lab house ID" value={asString(labContext?.labHouseId)} />
            <Field label="Wrote manual payload" value={String(labContext?.wroteManualPayload ?? false)} />
            <Field label="Write target" value={asString(labContext?.writeTarget)} />
          </FieldGrid>
        ) : null}
        <WarningsList
          warnings={Array.isArray(seedDiagnostics?.warnings) ? (seedDiagnostics.warnings as string[]) : undefined}
        />
        <JsonDetails label="Prepare seed JSON" value={prepareResult} />
      </StepSection>

      <StepSection
        step={4}
        title="Run / Readback"
        description="Run Past Sim on lab home from the prepared lab seed; read back lab simulated usage."
        stale={isStale(step4)}
      >
        <p className="text-sm text-slate-600">
          Uses expected hashes from earlier steps when available: seed hash (Step 3), source interval fingerprint
          (Step 1), validation policy hash (Step 2 / Step 1).
        </p>
        <button
          type="button"
          disabled={busyStep === "step4" || sameHouseBlocked(sourceHouseId, labHouseId)}
          onClick={() => void runStep4()}
          className="mt-3 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busyStep === "step4" ? "Running…" : "Run Past Sim on lab home"}
        </button>
        {runResult ? (
          <FieldGrid>
            <Field label="Run status" value={asString(runResult.status)} />
            <Field label="Dispatched" value={String(run?.dispatched ?? false)} />
            <Field label="Scenario ID" value={asString(run?.scenarioId)} />
            <Field label="Artifact input hash" value={asString(run?.artifactInputHash)} />
            <Field label="Build inputs hash" value={asString(run?.buildInputsHash)} />
            <Field label="Simulator mode" value={asString(run?.simulatorMode)} />
            <Field label="Input type" value={asString(run?.inputType)} />
            <Field label="Artifact persisted" value={String(run?.persisted ?? false)} />
            <Field label="Readback coverage start" value={asString(readback?.coverageStart)} />
            <Field label="Readback coverage end" value={asString(readback?.coverageEnd)} />
            <Field label="Daily row count (lab simulated usage)" value={asNumber(readback?.dailyRowCount)} />
            <Field label="Interval count (lab simulated usage)" value={asNumber(readback?.intervalCount)} />
            <Field label="Simulated total kWh (lab simulated usage)" value={asNumber(readback?.totalKwh)} />
            <Field label="Source" value={asString(readback?.source)} />
            <Field label="Source detail" value={asString(readback?.sourceDetail)} />
            <Field label="Bill Match status" value={asString(readback?.billMatchStatus)} />
            <Field label="Interval shape" value={asString(readback?.intervalShape)} />
            <Field label="Baseload 15-min kWh" value={asNumber(readback?.baseload15MinKwh)} />
          </FieldGrid>
        ) : null}
        <WarningsList
          warnings={Array.isArray(runDiagnostics?.warnings) ? (runDiagnostics.warnings as string[]) : undefined}
        />
        <JsonDetails label="Run/readback JSON" value={runResult} />
      </StepSection>

      <StepSection
        step={5}
        title="Compare"
        description="Compare source actual usage vs lab simulated usage (admin diagnostic only)."
        stale={isStale(step5)}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDailyRows}
            onChange={(e) => setIncludeDailyRows(e.target.checked)}
          />
          <span className="font-semibold">Include daily rows in compare response</span>
        </label>
        <button
          type="button"
          disabled={busyStep === "step5" || sameHouseBlocked(sourceHouseId, labHouseId)}
          onClick={() => void runStep5()}
          className="mt-3 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busyStep === "step5" ? "Comparing…" : "Compare source actual vs lab simulated"}
        </button>
        {compareResult ? (
          <>
            <FieldGrid>
              <Field label="Compare status" value={asString(compareResult.status)} />
              <Field label="Compare scope" value={asString(compare?.compareScope)} />
              <Field label="Compare basis" value={asString(compare?.compareBasis)} />
              <Field label="Actual total kWh (source actual usage)" value={asNumber(compare?.actualTotalKwh)} />
              <Field label="Simulated total kWh (lab simulated usage)" value={asNumber(compare?.simulatedTotalKwh)} />
              <Field label="Delta kWh" value={asNumber(compare?.deltaKwh)} />
              <Field label="Percent delta" value={asNumber(compare?.percentDelta)} />
              <Field label="Source actual kind" value={asString(sourceActual?.actualSourceKind)} />
              <Field label="Lab simulated total kWh" value={asNumber(labSimulated?.totalKwh)} />
              <Field label="Lab simulated source" value={asString(labSimulated?.source)} />
              <Field label="Lab simulated source detail" value={asString(labSimulated?.sourceDetail)} />
            </FieldGrid>
            {annualCompare ? (
              <FieldGrid>
                <Field label="Annual actual kWh (source actual usage)" value={asNumber(annualCompare.actualKwh)} />
                <Field
                  label="Annual simulated kWh (lab simulated usage)"
                  value={asNumber(annualCompare.simulatedKwh)}
                />
                <Field label="Annual delta kWh" value={asNumber(annualCompare.deltaKwh)} />
              </FieldGrid>
            ) : null}
            {monthlyCompare ? (
              <p className="mt-3 text-sm text-slate-700">
                Monthly rows: {asNumber(monthlyCompare.rowCount)} · matched {asNumber(monthlyCompare.matchedCount)}
              </p>
            ) : null}
            {dailySummary ? (
              <FieldGrid>
                <Field label="Compared day count" value={asNumber(dailySummary.comparedDayCount)} />
                <Field label="Missing source actual days" value={asNumber(dailySummary.missingActualDayCount)} />
                <Field label="Missing lab simulated days" value={asNumber(dailySummary.missingSimulatedDayCount)} />
                <Field label="Mean abs daily delta kWh" value={asNumber(dailySummary.meanAbsoluteDailyDeltaKwh)} />
              </FieldGrid>
            ) : null}
            {includeDailyRows && dailyRows.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Source actual kWh</th>
                      <th className="px-2 py-1">Lab simulated kWh</th>
                      <th className="px-2 py-1">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.map((row) => {
                      const rec = asRecord(row);
                      return (
                        <tr key={String(rec?.date)} className="border-b border-slate-100">
                          <td className="px-2 py-1">{asString(rec?.date)}</td>
                          <td className="px-2 py-1">{asNumber(rec?.actualKwh)}</td>
                          <td className="px-2 py-1">{asNumber(rec?.simulatedKwh)}</td>
                          <td className="px-2 py-1">{asNumber(rec?.deltaKwh)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
        <WarningsList
          warnings={
            Array.isArray(compareDiagnostics?.warnings) ? (compareDiagnostics.warnings as string[]) : undefined
          }
        />
        <JsonDetails label="Compare JSON" value={compareResult} />
      </StepSection>
    </div>
  );
}

export default ManualGapfillAdmin;
