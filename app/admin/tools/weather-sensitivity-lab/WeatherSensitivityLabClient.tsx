"use client";

import { useMemo, useState } from "react";
import { WeatherSensitivityLabView } from "@/components/admin/WeatherSensitivityLabView";

type LabResponse =
  | {
      ok: true;
      user: { id: string; email: string } | null;
      houses: Array<{
        houseId: string;
        label: string;
        score: any | null;
      }>;
      selectedHouseId: string | null;
    }
  | { ok: false; error: string };

export default function WeatherSensitivityLabClient() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabResponse | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);

  const selectedHouse = useMemo(() => {
    if (!result || result.ok !== true) return null;
    return result.houses.find((house) => house.houseId === (selectedHouseId ?? result.selectedHouseId)) ?? null;
  }, [result, selectedHouseId]);

  const ranking = useMemo(() => {
    if (!result || result.ok !== true || !selectedHouse?.score) return null;
    const ranked = [...result.houses]
      .filter((house) => house.score != null)
      .sort((a, b) => (b.score?.weatherEfficiencyScore0to100 ?? 0) - (a.score?.weatherEfficiencyScore0to100 ?? 0));
    const index = ranked.findIndex((house) => house.houseId === selectedHouse.houseId);
    if (index < 0) return null;
    return {
      currentRank: index + 1,
      totalPeers: ranked.length,
      higherScoreCount: index,
      lowerScoreCount: Math.max(0, ranked.length - index - 1),
    };
  }, [result, selectedHouse]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/tools/weather-sensitivity-lab?email=${encodeURIComponent(email.trim())}${selectedHouseId ? `&houseId=${encodeURIComponent(selectedHouseId)}` : ""}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as LabResponse | null;
      if (!res.ok || !json) {
        setError("Unable to load weather sensitivity lab data.");
        setResult(null);
        return;
      }
      setResult(json);
      if (json.ok) setSelectedHouseId(json.selectedHouseId);
      else setError(json.error);
    } catch {
      setError("Unable to load weather sensitivity lab data.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-navy/60">
          Shared Weather Sensitivity Scoring
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-navy">Weather Sensitivity Lab</h1>
        <p className="mt-2 text-sm text-brand-navy/75">
          Load one user, inspect every house score produced by the shared owner, and compare how homes position against
          one another without introducing any lab-only formulas.
        </p>
        <div className="mt-4 flex flex-col gap-3 md:flex-row">
          <input
            className="w-full rounded-xl border border-brand-blue/20 px-4 py-3 text-sm text-brand-navy outline-none"
            placeholder="Customer email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={!email.trim() || loading}
            className="rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
        {result && result.ok === true && result.houses.length > 0 ? (
          <div className="mt-4">
            <label className="text-sm font-medium text-brand-navy">
              House
              <select
                className="mt-1 w-full rounded-xl border border-brand-blue/20 px-4 py-3 text-sm text-brand-navy"
                value={selectedHouseId ?? result.selectedHouseId ?? ""}
                onChange={(event) => setSelectedHouseId(event.target.value)}
              >
                {result.houses.map((house) => (
                  <option key={house.houseId} value={house.houseId}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {error ? <div className="mt-3 text-sm text-rose-700">{error}</div> : null}
      </section>

      {selectedHouse ? (
        <WeatherSensitivityLabView
          selectedHouseLabel={selectedHouse.label}
          score={selectedHouse.score}
          peerRanking={ranking}
        />
      ) : null}
    </div>
  );
}
