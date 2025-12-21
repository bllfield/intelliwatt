import { describe, expect, it, vi } from "vitest";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";

describe("fetchEflPdfFromUrl - proxy fallback (HTML-resolved candidate)", () => {
  it("uses EFL_FETCH_PROXY_URL when landing-page candidate fetch is 403", async () => {
    const originalFetch = globalThis.fetch;
    const originalProxyUrl = process.env.EFL_FETCH_PROXY_URL;
    const originalProxyToken = process.env.EFL_FETCH_PROXY_TOKEN;

    process.env.EFL_FETCH_PROXY_URL = "https://proxy.example/fetch";
    process.env.EFL_FETCH_PROXY_TOKEN = "secret-token";

    const calls: Array<{ url: string }> = [];
    const fakePdfBytes = new TextEncoder().encode("%PDF-1.7\n...");

    // The landing page contains a link to the "real" doc URL.
    const landingUrl = "https://landing.example/page";
    const blockedDocUrl = "https://blocked.example/doc.pdf";

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url });

      if (url === landingUrl) {
        return new Response(
          `<html><body><a href="${blockedDocUrl}">Electricity Facts Label</a></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }

      // Candidate PDF fetch fails (simulating WAF on Vercel).
      if (url === blockedDocUrl) {
        return new Response("<html>blocked</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        });
      }

      // Proxy fetch succeeds.
      if (url === "https://proxy.example/fetch") {
        expect(init?.headers?.authorization || init?.headers?.Authorization).toBe(
          "Bearer secret-token",
        );
        return new Response(fakePdfBytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "x-final-url": blockedDocUrl,
          },
        });
      }

      return new Response("unexpected", { status: 500 });
    }) as any;

    try {
      const res = await fetchEflPdfFromUrl(landingUrl, { timeoutMs: 5000 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.pdfBytes.byteLength).toBeGreaterThan(5);
        expect(res.notes.join("\n")).toContain("proxy_context=landing_candidate");
        expect(res.notes.join("\n")).toContain("proxy_fallback=1");
        expect(res.notes.join("\n")).toContain("proxy_ok=1");
      }

      expect(calls.some((c) => c.url === "https://proxy.example/fetch")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.EFL_FETCH_PROXY_URL = originalProxyUrl;
      process.env.EFL_FETCH_PROXY_TOKEN = originalProxyToken;
    }
  });
});

