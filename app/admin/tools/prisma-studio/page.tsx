"use client";

import { useState } from "react";

type Block = {
  title: string;
  body: string;
  note?: string;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function PrismaStudioShortcutsPage() {
  const [copiedTitle, setCopiedTitle] = useState<string | null>(null);

  const blocks: Block[] = [
    {
      title: "Master (pooled via DATABASE_URL)",
      body: [
        "# Set DATABASE_URL in this PowerShell session (from your password manager / Vercel env / .env)",
        '$env:DATABASE_URL = "<PASTE_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5555",
      ].join("\n"),
      note: "We intentionally do not embed real DB credentials in the repo/UI.",
    },
    {
      title: "Current Plan module",
      body: [
        '$env:CURRENT_PLAN_DATABASE_URL = "<PASTE_CURRENT_PLAN_DATABASE_URL_HERE>"',
        "npx prisma studio --schema=prisma/current-plan/schema.prisma --browser none --port 5556",
      ].join("\n"),
    },
    {
      title: "Usage module",
      body: [
        '$env:USAGE_DATABASE_URL = "<PASTE_USAGE_DATABASE_URL_HERE>"',
        "npx prisma studio --schema=prisma/usage/schema.prisma --browser none --port 5557",
      ].join("\n"),
    },
    {
      title: "Home Details module",
      body: [
        '$env:DATABASE_URL = "<PASTE_HOME_DETAILS_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5558",
      ].join("\n"),
    },
    {
      title: "Appliances module",
      body: [
        '$env:DATABASE_URL = "<PASTE_APPLIANCES_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5559",
      ].join("\n"),
    },
    {
      title: "Upgrades module",
      body: [
        '$env:DATABASE_URL = "<PASTE_UPGRADES_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5560",
      ].join("\n"),
    },
    {
      title: "WattBuy Offers module",
      body: [
        '$env:DATABASE_URL = "<PASTE_WATTBUY_OFFERS_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5561",
      ].join("\n"),
    },
    {
      title: "Referrals module",
      body: [
        '$env:DATABASE_URL = "<PASTE_REFERRALS_DATABASE_URL_HERE>"',
        "npx prisma studio --browser none --port 5562",
      ].join("\n"),
    },
  ];

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-brand-white rounded-lg p-6 shadow-lg space-y-3">
          <h1 className="text-2xl font-bold text-brand-navy">🛠️ Prisma Studio Shortcuts</h1>
          <p className="text-sm text-brand-navy/70">
            Copy a block into a local PowerShell window to open Prisma Studio for a specific database.
            Each block binds Studio to its own port.
          </p>
          <p className="text-xs text-brand-navy/60">
            Tip: run each block in a fresh window, and stop the Studio process when finished (Ctrl+C or closing the console).
          </p>
        </section>

        <section className="bg-brand-white rounded-lg p-6 shadow-lg">
          <div className="space-y-4">
            {blocks.map((b) => (
              <div key={b.title} className="rounded-xl border border-brand-navy/10 bg-brand-navy/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-brand-navy">{b.title}</div>
                  <button
                    type="button"
                    className="rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/20"
                    onClick={async () => {
                      const ok = await copyToClipboard(b.body);
                      if (ok) {
                        setCopiedTitle(b.title);
                        setTimeout(() => setCopiedTitle(null), 1200);
                      }
                    }}
                  >
                    {copiedTitle === b.title ? "Copied" : "Copy"}
                  </button>
                </div>
                {b.note ? <div className="mt-2 text-xs text-brand-navy/70">{b.note}</div> : null}
                <pre className="mt-3 whitespace-pre-wrap text-sm font-mono text-brand-navy">{b.body}</pre>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


