'use client';

import { useState, useTransition } from 'react';
import { normalizeLatestServerAction } from './actions';

export default function AdminSmtToolsPage() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(5);

  const handleNormalize = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const payload = await normalizeLatestServerAction(limit);
        setResult(payload);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">SMT Tools</h1>
        <p className="text-sm text-neutral-600">
          Trigger normalization runs without exposing the admin token in-browser. Uses server actions to proxy your request.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={100}
            className="w-24 rounded border px-2 py-1"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 1)}
          />
        </label>

        <button
          type="button"
          onClick={handleNormalize}
          disabled={isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Normalizing…' : `Normalize Latest (limit=${limit})`}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <pre className="max-h-[480px] overflow-auto rounded bg-neutral-900 p-4 text-xs text-neutral-100">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
