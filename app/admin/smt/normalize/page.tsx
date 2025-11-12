"use client";

import React from "react";

type NormalizeResult = {
  ok: boolean;
  status?: number;
  data?: any;
  error?: string;
};

export default function AdminSmtNormalizePage() {
  const [limit, setLimit] = React.useState<string>("5");
  const [out, setOut] = React.useState<string>("");

  async function callNormalize(dryRun: boolean) {
    setOut("Running...");
    try {
      const params = new URLSearchParams();
      if (limit) params.set("limit", limit);
      if (dryRun) params.set("dryRun", "1");

      const res = await fetch(`/api/admin/ui/smt/normalize?` + params.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });

      const text = await res.text();
      let json: NormalizeResult | { raw: string };
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      const pretty = JSON.stringify(json, null, 2);
      setOut(pretty);
    } catch (err: any) {
      setOut(`ERROR: ${err?.message ?? String(err)}`);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Admin → SMT → Normalize</h1>
      <p className="text-sm text-gray-600">
        This page calls the server-side proxy at <code>/api/admin/ui/smt/normalize</code>, which adds the admin header on the server.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm w-28">Limit</label>
        <input
          className="border rounded px-2 py-1 w-24"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          inputMode="numeric"
          aria-label="limit"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => callNormalize(true)}
          className="rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700"
        >
          Dry Run (no writes)
        </button>
        <button
          onClick={() => callNormalize(false)}
          className="rounded px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Live Normalize (writes)
        </button>
      </div>

      <pre className="bg-black text-green-200 p-4 rounded text-xs overflow-auto min-h-[200px] whitespace-pre-wrap">
        {out || "Output will appear here."}
      </pre>
    </div>
  );
}
