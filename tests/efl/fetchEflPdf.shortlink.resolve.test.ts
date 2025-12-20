import { describe, expect, it, vi } from "vitest";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";

describe("fetchEflPdfFromUrl - shortlink resolve then direct fetch", () => {
  it("resolves bit.ly to final URL and fetches PDF from final directly", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = [];

    const fakePdfBytes = new TextEncoder().encode("%PDF-1.7\n...");

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, redirect: init?.redirect });

      if (url === "https://bit.ly/abc" && init?.redirect === "manual") {
        return new Response("", {
          status: 302,
          headers: { location: "https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx?ProductDocumentID=999" },
        });
      }

      if (url.startsWith("https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx") && init?.redirect === "follow") {
        return new Response(fakePdfBytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }

      return new Response("unexpected", { status: 500 });
    }) as any;

    try {
      const res = await fetchEflPdfFromUrl("https://bit.ly/abc", { timeoutMs: 5000 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.pdfUrl).toContain("ohm-gridlink.smartgridcis.net");
        expect(res.pdfBytes.byteLength).toBeGreaterThan(5);
      }

      // Ensure we did the manual-redirect resolve.
      expect(calls.some((c) => c.url === "https://bit.ly/abc" && c.redirect === "manual")).toBe(true);
      // Ensure we fetched the final URL with follow redirects (the normal fetch path).
      expect(calls.some((c) => c.url.includes("ProductDocumentID=999") && c.redirect === "follow")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

