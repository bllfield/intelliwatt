export const dynamic = "force-dynamic";

import React from "react";
import { Buffer } from "node:buffer";
import { computePdfSha256 } from "@/lib/efl/eflExtractor";

type LinkRunnerResult = {
  ok: boolean;
  url: string;
  sha256?: string;
  contentType?: string | null;
  contentLength?: number | null;
  error?: string;
};

/**
 * Fetch the PDF from the provided URL and compute its SHA-256 fingerprint.
 * Vendor-agnostic: works with WattBuy, REP portals, or manual links.
 */
async function runLinkPipeline(rawUrl: string): Promise<LinkRunnerResult> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, url: rawUrl, error: "Missing URL" };
  }

  let normalizedUrl: string;
  try {
    const url = new URL(trimmed);
    normalizedUrl = url.toString();
  } catch {
    return { ok: false, url: rawUrl, error: "Invalid URL" };
  }

  try {
    const res = await fetch(normalizedUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type");
    const lengthHeader = res.headers.get("content-length");
    const contentLength = lengthHeader ? Number(lengthHeader) : null;

    const arrayBuffer = await res.arrayBuffer();
    const pdfBytes = Buffer.from(arrayBuffer);
    const sha256 = computePdfSha256(pdfBytes);

    return {
      ok: true,
      url: normalizedUrl,
      sha256,
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
    };
  } catch (err) {
    return {
      ok: false,
      url: trimmed,
      error: err instanceof Error ? err.message : "Unknown error while fetching PDF",
    };
  }
}

interface PageProps {
  searchParams?: {
    eflUrl?: string;
    sourceTag?: string;
  };
}

/**
 * /admin/efl/links — vendor-agnostic EFL link runner.
 */
export default async function EflLinkRunnerPage({ searchParams }: PageProps) {
  const eflUrl = searchParams?.eflUrl?.trim() ?? "";
  const sourceTag = searchParams?.sourceTag?.trim() ?? "";
  const hasUrl = eflUrl.length > 0;

  const result = hasUrl ? await runLinkPipeline(eflUrl) : null;

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">EFL Link Runner</h1>
        <p className="text-sm text-gray-500">
          Paste any EFL PDF URL (WattBuy, REP portal, manual) and this tool will fetch and fingerprint it.
          Use the SHA-256 fingerprint when flowing the PDF into the PlanRules/Fact Card pipeline.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <form method="GET" className="space-y-4">
          <div>
            <label htmlFor="eflUrl" className="block text-sm font-medium text-gray-700">
              EFL PDF URL
            </label>
            <input
              id="eflUrl"
              name="eflUrl"
              type="url"
              required
              defaultValue={eflUrl}
              placeholder="https://.../some-plan-efl.pdf"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Paste a direct link to an Electricity Facts Label PDF (works with WattBuy, REP portals, manual uploads, etc.).
            </p>
          </div>

          <div>
            <label htmlFor="sourceTag" className="block text-sm font-medium text-gray-700">
              Source tag (optional)
            </label>
            <input
              id="sourceTag"
              name="sourceTag"
              type="text"
              defaultValue={sourceTag}
              placeholder="wattbuy, rep_portal, manual, etc."
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional label for your own tracking. Not persisted yet.
            </p>
          </div>

          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Fetch &amp; Fingerprint PDF
          </button>
        </form>
      </section>

      {hasUrl && (
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="mt-1 text-xs text-gray-500">
            Live check against the provided URL. Use it to verify reachability and capture the SHA-256 fingerprint for downstream automation.
          </p>

          <div className="mt-3 space-y-2 text-sm">
            <div>
              <span className="font-medium">Requested URL: </span>
              <span className="break-all">{eflUrl}</span>
            </div>

            {result && (
              <>
                <div>
                  <span className="font-medium">Status: </span>
                  {result.ok ? (
                    <span className="text-green-600">OK</span>
                  ) : (
                    <span className="text-red-600">Error</span>
                  )}
                </div>

                {result.error && (
                  <div className="text-xs text-red-600">Error: {result.error}</div>
                )}

                {result.ok && (
                  <>
                    <div>
                      <span className="font-medium">Normalized URL: </span>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-blue-600 underline"
                      >
                        {result.url}
                      </a>
                    </div>

                    <div>
                      <span className="font-medium">PDF SHA-256: </span>
                      <span className="break-all font-mono text-xs">{result.sha256}</span>
                    </div>

                    <div className="text-xs text-gray-500">
                      <div>
                        <span className="font-medium">Content-Type: </span>
                        <span>{result.contentType ?? "unknown"}</span>
                      </div>
                      <div>
                        <span className="font-medium">Content-Length: </span>
                        <span>
                          {typeof result.contentLength === "number"
                            ? `${result.contentLength} bytes`
                            : "unknown"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border border-blue-600 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Open EFL PDF in new tab
                      </a>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

