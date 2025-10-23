export default function DevInstructionsPage() {
  return (
    <main className="max-w-3xl mx-auto p-6 text-white">
      <h1 className="text-3xl font-bold mb-4">🛠 IntelliWatt Dev Instructions</h1>
      <p className="text-brand-cyan mb-4">
        This is an internal developer-only reference page. Do NOT expose this route to end users.
      </p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-brand-cyan mb-2">📦 System Structure & Routing</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><code>/dashboard</code>: main hub (do not embed tools directly)</li>
          <li><code>/dashboard/*</code>: each page is its own isolated module</li>
          <li><code>/dashboard/api</code>: SMT + device connections only</li>
          <li><code>/dashboard/plans</code>: alerts, monitoring, switching logic</li>
          <li><code>/dashboard/analysis</code>: final energy insights ONLY (no inputs)</li>
          <li><code>/dashboard/manual-entry</code>: accepts Green Button or CSV uploads</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-brand-cyan mb-2">🚫 Do Not:</h2>
        <ul className="list-disc list-inside space-y-1 text-red-300">
          <li>Do NOT put backend logic inside pages</li>
          <li>Do NOT connect APIs directly without a dedicated module folder</li>
          <li>Do NOT store logic or state in dashboard root page</li>
          <li>Do NOT overwrite the existing magic link auth flow</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-brand-cyan mb-2">🧰 Tooling In Use</h2>
        <ul className="list-disc list-inside">
          <li><strong>Next.js 14 App Router</strong></li>
          <li><strong>Prisma</strong> (schema-driven DB, <code>@prisma/client</code>)</li>
          <li><strong>Nodemailer</strong> for login link emails</li>
          <li><strong>Cursor</strong> for AI dev</li>
          <li><strong>TailwindCSS</strong> for UI</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-brand-cyan mb-2">📄 See Full Docs:</h2>
        <p>
          View the full project blueprint in <code>/docs/architecture.md</code> in your repo.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold text-brand-cyan mb-2">📈 Upgrade Simulator</h2>
        <p>
          Route: <code>/dashboard/upgrades</code> – This tool analyzes all connected home data (usage, weather, HVAC, solar, appliances)
          and estimates monthly savings from upgrades. Results may be shown in dashboard or sent by email/text.
        </p>
      </section>
    </main>
  );
} 