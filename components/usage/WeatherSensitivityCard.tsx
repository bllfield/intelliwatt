"use client";

import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared";

function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-700";
  if (score >= 50) return "text-amber-700";
  return "text-rose-700";
}

function promptCopy(score: WeatherSensitivityScore): string | null {
  if (score.nextDetailPromptType === "ADD_APPLIANCE_DETAILS") {
    return "To narrow down which major loads are driving that weather swing, add more appliance details.";
  }
  if (score.nextDetailPromptType === "ADD_ENVELOPE_DETAILS") {
    return "To better understand whether the waste may be coming from your envelope, add insulation and window details.";
  }
  return null;
}

export function WeatherSensitivityCard(props: {
  score: WeatherSensitivityScore | null;
  title?: string;
  presentation?: "customer" | "admin";
}) {
  const score = props.score;
  if (!score) return null;

  const title = props.title ?? "Weather Efficiency Score";
  const modeLabel = score.scoringMode === "BILLING_PERIOD_BASED" ? "Billing-period based" : "Interval based";
  const prompt = promptCopy(score);
  const appearsWeatherSensitive = score.recommendationFlags.appearsWeatherSensitive;

  return (
    <section className="rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-navy/60">{modeLabel}</div>
          <h3 className="mt-1 text-lg font-semibold text-brand-navy">{title}</h3>
        </div>
        <div className={`text-3xl font-bold ${scoreTone(score.weatherEfficiencyScore0to100)}`}>
          {score.weatherEfficiencyScore0to100}
        </div>
      </div>

      <p className="mt-3 text-sm text-brand-navy/80">{score.explanationSummary}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-brand-blue/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Cooling sensitivity</div>
          <div className="mt-1 text-xl font-semibold text-brand-navy">{score.coolingSensitivityScore0to100}</div>
        </div>
        <div className="rounded-xl bg-brand-blue/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Heating sensitivity</div>
          <div className="mt-1 text-xl font-semibold text-brand-navy">{score.heatingSensitivityScore0to100}</div>
        </div>
        <div className="rounded-xl bg-brand-blue/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Confidence</div>
          <div className="mt-1 text-xl font-semibold text-brand-navy">{score.confidenceScore0to100}</div>
        </div>
      </div>

      {props.presentation !== "admin" ? (
        <div className="mt-4 rounded-xl border border-brand-blue/10 bg-brand-blue/5 px-4 py-3 text-sm text-brand-navy">
          {appearsWeatherSensitive
            ? "Your home looks weather sensitive, and there may be efficiency improvements worth reviewing."
            : "Your usage does not currently show an unusually strong weather swing."}
        </div>
      ) : null}

      {prompt ? <div className="mt-3 text-sm text-brand-navy/80">{prompt}</div> : null}
    </section>
  );
}
