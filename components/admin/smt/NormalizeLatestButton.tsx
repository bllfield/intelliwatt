"use client";

import { FormEvent, useState } from "react";

export type NormalizeLatestButtonProps = {
  action: (payload: { esiid?: string }) => Promise<any>;
};

export function NormalizeLatestButton({ action }: NormalizeLatestButtonProps) {
  const [esiid, setEsiid] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setIsLoading(true);

    try {
      const trimmed = esiid.trim();
      const payload: { esiid?: string } = {};
      if (trimmed) {
        payload.esiid = trimmed;
      }

      const response = await action(payload);
      setResult(response);
    } catch (err: any) {
      setError(err?.message || "Failed to normalize the latest SMT file.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Normalize Latest SMT File</h2>
        <p className="text-sm text-gray-600">
          Run the normalize pipeline for the most recent RAW SMT CSV. Provide an optional ESIID to narrow the
          selection; leave blank to normalize the global latest file.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="normalize-latest-esiid">
            ESIID (optional)
          </label>
          <input
            id="normalize-latest-esiid"
            type="text"
            value={esiid}
            onChange={(event) => setEsiid(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            placeholder="10443720004529147"
            autoComplete="off"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-2xl border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Running…" : "Normalize Latest"}
        </button>
      </form>

      <div className="mt-3 space-y-2">
        {isLoading && <p className="text-xs text-gray-500">Running…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {result && (
          <div>
            <div className="text-xs font-semibold text-gray-700">Result</div>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-800">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

