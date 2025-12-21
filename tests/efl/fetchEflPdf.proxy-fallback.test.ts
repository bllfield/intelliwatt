import { describe, expect, it, vi } from "vitest";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";

describe("fetchEflPdfFromUrl - proxy fallback", () => {
  it("uses EFL_FETCH_PROXY_URL when direct fetch is 403", async () => {
    const originalFetch = globalThis.fetch;
    const originalProxyUrl = process.env.EFL_FETCH_PROXY_URL;
    const originalProxyToken = process.env.EFL_FETCH_PROXY_TOKEN;

    process.env.EFL_FETCH_PROXY_URL = "https://proxy.example/fetch";
    process.env.EFL_FETCH_PROXY_TOKEN = "secret-token";

    const calls: Array<{ url: string; status?: number }> = [];
    const fakePdfBytes = new TextEncoder().encode("%PDF-1.7\n...");

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url });

      if (url === "https://blocked.example/doc.pdf") {
        return new Response("<html>blocked</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        });
      }

      if (url === "https://proxy.example/fetch") {
        // verify token is sent
        expect(init?.headers?.authorization || init?.headers?.Authorization).toBe(
          "Bearer secret-token",
        );
        return new Response(fakePdfBytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "x-final-url": "https://blocked.example/doc.pdf",
            "x-proxy-notes": "residential_ip",
          },
        });
      }

      return new Response("unexpected", { status: 500 });
    }) as any;

    try {
      const res = await fetchEflPdfFromUrl("https://blocked.example/doc.pdf", { timeoutMs: 5000 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.pdfBytes.byteLength).toBeGreaterThan(5);
        expect(res.notes.join("\n")).toContain("proxy_fallback=1");
        expect(res.notes.join("\n")).toContain("proxy_ok=1");
        expect(res.notes.join("\n")).toContain("proxy_finalUrl=https://blocked.example/doc.pdf");
      }

      expect(calls.some((c) => c.url === "https://proxy.example/fetch")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.EFL_FETCH_PROXY_URL = originalProxyUrl;
      process.env.EFL_FETCH_PROXY_TOKEN = originalProxyToken;
    }
  });
});

