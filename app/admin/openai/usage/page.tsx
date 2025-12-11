import OpenAIUsageClient from './OpenAIUsageClient';

export default function OpenAIUsagePage() {
  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-brand-white">OpenAI Usage</h1>
          <p className="text-sm text-brand-blue/80 mt-1">
            Admin-only view of OpenAI calls, tokens, and estimated cost. Data is sourced from the
            <code className="mx-1 rounded bg-brand-blue/20 px-1 py-0.5 text-xs text-brand-blue">
              /api/admin/openai/usage
            </code>
            endpoint.
          </p>
        </div>

        <div className="bg-brand-white rounded-lg shadow-lg p-4">
          <OpenAIUsageClient />
        </div>
      </div>
    </div>
  );
}


