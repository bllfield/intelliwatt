import React from "react";
import type {
  CalculationLogicArtifactDecision,
  CalculationLogicCompositionItem,
  CalculationLogicCompositionSection,
  CalculationLogicDecisionStep,
  CalculationLogicExclusionItem,
  CalculationLogicInputGroup,
  CalculationLogicLayer,
  CalculationLogicPriorityItem,
  CalculationLogicRunImpactItem,
  CalculationLogicShapeBucketSummary,
  CalculationLogicTuningLever,
  CalculationLogicWeatherRow,
  GapfillCalculationLogicSummary,
} from "@/modules/usageSimulator/calculationLogicSummary";

export const GAPFILL_CALCULATION_LOGIC_TRIGGER_LABEL = "View Calculation Logic";

function bandClasses(band: string): string {
  switch (band) {
    case "Hard Truth":
      return "bg-emerald-200 text-emerald-950 border-emerald-300";
    case "Hard Constraint":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "Reference Truth Pool":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "Primary Driver":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "Secondary Driver":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "Conditional Adjustment":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "Exclusion":
      return "bg-rose-100 text-rose-900 border-rose-200";
    case "Fallback Only":
      return "bg-slate-100 text-slate-900 border-slate-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function SectionTitle(props: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-brand-navy">{props.title}</h3>
      {props.subtitle ? <p className="mt-1 text-xs text-brand-navy/70">{props.subtitle}</p> : null}
    </div>
  );
}

function BandChip(props: { band: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${bandClasses(props.band)}`}>
      {props.band}
    </span>
  );
}

function InputCard(props: { item: CalculationLogicInputGroup }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
          <div className="mt-1 text-xs text-brand-navy/70">{props.item.role}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            props.item.status === "inactive"
              ? "bg-slate-100 text-slate-600"
              : props.item.status === "context only"
                ? "bg-sky-100 text-sky-900"
                : props.item.status === "modeled-subset-only"
                  ? "bg-violet-100 text-violet-900"
                  : "bg-brand-blue/10 text-brand-navy"
          }`}>
            {props.item.status}
          </span>
          <BandChip band={props.item.priorityBand} />
        </div>
      </div>
      {props.item.whereEntered.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {props.item.whereEntered.map((value) => (
            <span key={value} className="rounded-full bg-brand-blue/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-navy">
              {value}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Source of truth</div>
        <div className="mt-1 text-xs text-brand-navy/85">{props.item.sourceOfTruth}</div>
      </div>
      {props.item.evidence.length > 0 ? (
        <div className="mt-3 rounded border border-brand-blue/10 bg-brand-blue/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Artifact evidence</div>
          <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
            {props.item.evidence.map((detail) => (
              <li key={detail}>- {detail}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.item.details.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-brand-navy/80">
          {props.item.details.map((detail) => (
            <li key={detail}>- {detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LogicLayerCard(props: { layer: CalculationLogicLayer }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.layer.title}</div>
      <p className="mt-1 text-xs text-brand-navy/75">{props.layer.summary}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Variables used</div>
          <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
            {props.layer.variablesUsed.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Preserved / locked</div>
          <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
            {props.layer.preservedOrLocked.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Simulated / derived</div>
          <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
            {props.layer.simulatedOrDerived.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Priority / fallback order</div>
          <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
            {props.layer.fallbackOrder.length > 0 ? (
              props.layer.fallbackOrder.map((item) => <li key={item}>- {item}</li>)
            ) : (
              <li>- No additional fallback order attached for this layer.</li>
            )}
          </ul>
        </div>
      </div>
      {props.layer.modeSpecificRules.length > 0 ? (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Mode-specific rules</div>
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {props.layer.modeSpecificRules.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PriorityCard(props: { item: CalculationLogicPriorityItem | CalculationLogicTuningLever }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
        <BandChip band={props.item.priorityBand} />
      </div>
      <p className="mt-2 text-xs text-brand-navy/80">{props.item.explanation}</p>
    </div>
  );
}

function CompositionRow(props: { item: CalculationLogicCompositionItem }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
        <BandChip band={props.item.priorityBand} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4 text-xs text-brand-navy/80">
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">Days</div>
          <div className="mt-1">{props.item.dayCount ?? "n/a"}</div>
          <div className="text-brand-navy/60">{props.item.dayShare != null ? `${(props.item.dayShare * 100).toFixed(1)}% share` : "share n/a"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3">
          <div className="font-semibold text-brand-navy">kWh</div>
          <div className="mt-1">{props.item.kwh != null ? props.item.kwh.toFixed(2) : "n/a"}</div>
          <div className="text-brand-navy/60">{props.item.kwhShare != null ? `${(props.item.kwhShare * 100).toFixed(1)}% share` : "share n/a"}</div>
        </div>
        <div className="rounded border border-brand-blue/10 bg-brand-navy/5 p-3 md:col-span-2">
          <div className="font-semibold text-brand-navy">Why it matters</div>
          <div className="mt-1">{props.item.explanation}</div>
        </div>
      </div>
    </div>
  );
}

function CompositionSectionCard(props: { section: CalculationLogicCompositionSection }) {
  return (
    <section className="space-y-4">
      <SectionTitle title={props.section.title} subtitle={props.section.summary} />
      <div className="grid gap-4 xl:grid-cols-2">
        {props.section.items.length > 0 ? (
          props.section.items.map((item) => <CompositionRow key={item.label} item={item} />)
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            No artifact-backed rows were attached for this composition slice.
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionLadderCard(props: { title: string; subtitle: string; summary: string; steps: CalculationLogicDecisionStep[] }) {
  return (
    <section className="space-y-4">
      <SectionTitle title={props.title} subtitle={props.subtitle} />
      <div className="rounded-2xl border border-brand-blue/10 bg-white p-5 shadow-sm">
        <p className="text-xs text-brand-navy/75">{props.summary}</p>
        <div className="mt-4 space-y-3">
          {props.steps.map((step) => (
            <div key={step.key} className="rounded-xl border border-brand-blue/10 bg-brand-navy/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-brand-navy">
                  {step.rank}. {step.label}
                </div>
                <div className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-navy">
                  observed {step.observedCount ?? 0}
                </div>
              </div>
              <p className="mt-2 text-xs text-brand-navy/80">{step.explanation}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WeatherRowCard(props: { row: CalculationLogicWeatherRow }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.row.label}</div>
      <div className="mt-2 rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs font-mono text-brand-navy/90">
        {props.row.value}
      </div>
      <p className="mt-2 text-xs text-brand-navy/80">{props.row.explanation}</p>
    </div>
  );
}

function ArtifactDecisionCard(props: { item: CalculationLogicArtifactDecision }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
        <div className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-navy">
          current run
        </div>
      </div>
      <div className="mt-3 rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs font-mono text-brand-navy/90">
        {props.item.value}
      </div>
      <p className="mt-2 text-xs text-brand-navy/80">{props.item.explanation}</p>
    </div>
  );
}

function RunImpactCard(props: { item: CalculationLogicRunImpactItem }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
      <div className="mt-3 rounded border border-brand-blue/10 bg-brand-navy/5 p-3 text-xs font-mono text-brand-navy/90">
        {props.item.value}
      </div>
      <p className="mt-2 text-xs text-brand-navy/80">{props.item.explanation}</p>
    </div>
  );
}

function ShapeBucketCard(props: { bucket: CalculationLogicShapeBucketSummary }) {
  const segments = [
    { label: "Overnight", value: props.bucket.overnight },
    { label: "Morning", value: props.bucket.morning },
    { label: "Afternoon", value: props.bucket.afternoon },
    { label: "Evening", value: props.bucket.evening },
  ];
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-brand-navy">{props.bucket.monthKey}</div>
        <div className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-navy">
          {props.bucket.dayType}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {segments.map((segment) => (
          <div key={segment.label}>
            <div className="flex items-center justify-between text-[11px] text-brand-navy/75">
              <span>{segment.label}</span>
              <span>{(segment.value * 100).toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-2 rounded bg-brand-blue/10">
              <div
                className="h-2 rounded bg-brand-blue"
                style={{ width: `${Math.max(3, segment.value * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExclusionCard(props: { item: CalculationLogicExclusionItem }) {
  return (
    <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-brand-navy">{props.item.label}</div>
        <div className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-900">
          {props.item.value}
        </div>
      </div>
      <p className="mt-2 text-xs text-brand-navy/80">{props.item.effect}</p>
    </div>
  );
}

export function GapFillCalculationLogicLauncher(props: { onOpen: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      disabled={props.disabled}
      className="rounded-full border border-brand-blue/20 bg-white px-4 py-2 text-sm font-semibold text-brand-navy shadow-sm hover:bg-brand-blue/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {GAPFILL_CALCULATION_LOGIC_TRIGGER_LABEL}
    </button>
  );
}

export function GapFillCalculationLogicModal(props: {
  open: boolean;
  onClose: () => void;
  summary: GapfillCalculationLogicSummary | null;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-3xl border border-brand-blue/15 bg-slate-50 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-blue/10 bg-white px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-brand-navy">GapFill Calculation Logic</div>
            <div className="mt-1 text-xs text-brand-navy/65">
              Read-only explanation built from persisted lockbox, artifact, and diagnostics metadata.
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-brand-blue/20 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5"
          >
            Close
          </button>
        </div>
        <div className="space-y-6 px-6 py-5">
          {props.summary ? (
            <>
              <section className="rounded-2xl border border-brand-blue/10 bg-white p-5 shadow-sm">
                <SectionTitle
                  title="Mode Overview"
                  subtitle="Top-level explanation of which mode ran, what Stage 1 path fed it, and whether the shared Stage 2 producer path was used."
                />
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-brand-blue/10 bg-brand-navy/5 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Selected GapFill mode</div>
                    <div className="mt-2 text-lg font-semibold text-brand-navy">{props.summary.modeLabel}</div>
                    <div className="mt-2 text-xs text-brand-navy/75">{props.summary.modeOverview}</div>
                  </div>
                  <div className="rounded-xl border border-brand-blue/10 bg-brand-navy/5 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-navy/55">Run context</div>
                    <ul className="mt-2 space-y-1 text-xs text-brand-navy/85">
                      <li>- Stage 1 path: {props.summary.stageOnePath}</li>
                      <li>- Stage 2 path: {props.summary.stageTwoPath}</li>
                      <li>- Shared producer path used: {String(props.summary.sharedProducerPathUsed)}</li>
                      <li>- Source home: {props.summary.sourceHouseId ?? "not attached"}</li>
                      <li>- Test home: {props.summary.testHomeId ?? "not attached"}</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="What Is Actual Vs What Is Simulated"
                  subtitle="This comes first so the current mode immediately explains how much of the final output is hard truth, how much is modeled, what the compare/test window contains, and how large the trusted reference pool stayed."
                />
                <div className="space-y-6">
                  {props.summary.compositionSections.map((section) => (
                    <CompositionSectionCard key={section.key} section={section} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Inputs / Variables Used"
                  subtitle="Each input group now states whether it was hard truth, an active driver, modeled-subset-only, context only, or inactive for this artifact, plus where it entered the flow and what evidence supports that label."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.inputGroups.map((item) => (
                    <InputCard key={item.key} item={item} />
                  ))}
                </div>
              </section>

              <DecisionLadderCard
                title="Daily Total Logic"
                subtitle="This section answers where the day's total kWh came from."
                summary={props.summary.dailyTotalLogic.summary}
                steps={props.summary.dailyTotalLogic.ladder}
              />

              <DecisionLadderCard
                title="Interval Curve Logic"
                subtitle="This section answers where the 96-slot interval shape came from after the day total was chosen."
                summary={props.summary.intervalCurveLogic.summary}
                steps={props.summary.intervalCurveLogic.ladder}
              />

              <section className="space-y-4">
                <SectionTitle
                  title="How Weather Changes The Result"
                  subtitle="Weather is shown as a post-selection daily adjustment plus a weather-regime shape influence. No fake weighting math is introduced."
                />
                <div className="rounded-2xl border border-brand-blue/10 bg-white p-5 shadow-sm">
                  <p className="text-xs text-brand-navy/75">{props.summary.weatherExplanation.summary}</p>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    {props.summary.weatherExplanation.rows.map((row) => (
                      <WeatherRowCard key={row.label} row={row} />
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Calculation Flow By Layer"
                  subtitle="Full persisted pipeline context after the top-level composition, daily-total ladder, interval-shape ladder, and weather behavior are understood."
                />
                <div className="space-y-4">
                  {props.summary.layers.map((layer) => (
                    <LogicLayerCard key={layer.key} layer={layer} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Influence / Priority Hierarchy"
                  subtitle="Truthful influence classes only: hard truth, hard constraint, reference truth pool, primary driver, conditional adjustment, secondary driver, exclusion, and fallback only."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.priorityItems.map((item) => (
                    <PriorityCard key={item.label} item={item} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Exclusions / Disqualifiers"
                  subtitle="These rows explain what got removed from trusted reference truth, what stayed in compare scope, and what was later filled or modeled."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.exclusions.map((item) => (
                    <ExclusionCard key={item.label} item={item} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Main Tuning Levers"
                  subtitle="Informational only in this pass. These explain what would move the result most for the selected mode."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.tuningLevers.map((item) => (
                    <PriorityCard key={item.label} item={item} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Current Artifact Decision Summary"
                  subtitle="This is the run-specific answer to 'what actually happened in this artifact?'"
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.artifactDecisionSummary.map((item) => (
                    <ArtifactDecisionCard key={item.label} item={item} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="What Changed The Result Most In This Run"
                  subtitle="Run-specific materiality summary only. This is not generic simulator prose."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.runImpactSummary.map((item) => (
                    <RunImpactCard key={item.label} item={item} />
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Fingerprint Curve Shape Summary"
                  subtitle="Readable month/day-type curve-shape shares promoted from artifact-backed fingerprint diagnostics so interval-shape tuning is easier to reason about."
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  {props.summary.shapeBucketSummaries.length > 0 ? (
                    props.summary.shapeBucketSummaries.map((bucket) => (
                      <ShapeBucketCard key={bucket.bucketKey} bucket={bucket} />
                    ))
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      No readable fingerprint curve-shape summaries were attached to this artifact.
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-4">
                <SectionTitle
                  title="Raw Diagnostics"
                  subtitle="Secondary only. The readable explanation above is primary; this collapse exposes the underlying artifact-backed metadata when needed."
                />
                <details className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Show raw calculation-logic diagnostics</summary>
                  <pre className="mt-3 overflow-x-auto rounded bg-brand-navy/5 p-3 text-xs text-brand-navy/90">
                    {JSON.stringify(props.summary.rawDiagnostics, null, 2)}
                  </pre>
                </details>
              </section>
            </>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
              Calculation logic is only available after GapFill has a persisted test-house result to explain. Run canonical recalc first, then reopen this modal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
