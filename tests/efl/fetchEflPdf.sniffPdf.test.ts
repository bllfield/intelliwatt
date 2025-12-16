import { describe, expect, it, vi } from "vitest";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";

describe("fetchEflPdfFromUrl - PDF sniffing tolerance", () => {
  it("treats bytes as PDF even when Content-Type is not application/pdf and header is not at byte 0", async () => {
    const originalFetch = globalThis.fetch;

    const fakePdfBytes = new TextEncoder().encode("\n%PDF-1.7\n%âãÏÓ\n");
    globalThis.fetch = vi.fn(async () => {
      return new Response(fakePdfBytes, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
      });
    }) as any;

    try {
      const res = await fetchEflPdfFromUrl(
        "https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx?ProductDocumentID=32831",
        { timeoutMs: 5000 },
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.pdfBytes.byteLength).toBeGreaterThan(10);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


