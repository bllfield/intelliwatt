"use client";

import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared";
import { WeatherSensitivityAdminDiagnostics } from "@/components/admin/WeatherSensitivityAdminDiagnostics";

export function WeatherSensitivityLabView(props: {
  selectedHouseLabel: string;
  score: WeatherSensitivityScore | null;
  peerRanking?: {
    currentRank: number;
    totalPeers: number;
    higherScoreCount: number;
    lowerScoreCount: number;
  } | null;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-navy/60">
          Weather Sensitivity Lab
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-navy">{props.selectedHouseLabel}</h1>
        <p className="mt-2 text-sm text-brand-navy/75">
          current score position, shared coefficients, and factor-driven interpretation all come from the same shared
          scoring owner.
        </p>
        {props.peerRanking ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-brand-blue/5 p-3 text-sm text-brand-navy">
              <div className="text-xs uppercase tracking-wide text-brand-navy/60">Current rank</div>
              <div className="mt-1 text-xl font-semibold">{props.peerRanking.currentRank}</div>
            </div>
            <div className="rounded-xl bg-brand-blue/5 p-3 text-sm text-brand-navy">
              <div className="text-xs uppercase tracking-wide text-brand-navy/60">Peer count</div>
              <div className="mt-1 text-xl font-semibold">{props.peerRanking.totalPeers}</div>
            </div>
            <div className="rounded-xl bg-brand-blue/5 p-3 text-sm text-brand-navy">
              <div className="text-xs uppercase tracking-wide text-brand-navy/60">Higher score count</div>
              <div className="mt-1 text-xl font-semibold">{props.peerRanking.higherScoreCount}</div>
            </div>
            <div className="rounded-xl bg-brand-blue/5 p-3 text-sm text-brand-navy">
              <div className="text-xs uppercase tracking-wide text-brand-navy/60">Lower score count</div>
              <div className="mt-1 text-xl font-semibold">{props.peerRanking.lowerScoreCount}</div>
            </div>
          </div>
        ) : null}
      </section>

      <WeatherSensitivityAdminDiagnostics
        score={props.score}
        derivedInput={
          props.score
            ? {
                ...props.score,
                derivedInputAttached: true,
                simulationActive: false,
              }
            : null
        }
      />
    </div>
  );
}
