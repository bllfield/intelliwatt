import { describe, expect, it, vi } from "vitest";

import { __extractLikelyInlineEflTextForTest, fetchEflSourceFromUrl } from "@/lib/efl/fetchEflPdf";

describe("fetchEflSourceFromUrl - inline HTML EFL fallback", () => {
  it("extracts raw text when the EFL page is HTML instead of PDF", async () => {
    const originalFetch = globalThis.fetch;
    const html = `
      <html>
        <body>
          <h1>Electricity Facts Label (EFL)</h1>
          <div>Average Monthly Use (Residential)</div>
          <table>
            <tr><td>500 kWh</td><td>31.0¢</td></tr>
            <tr><td>1000 kWh</td><td>30.2¢</td></tr>
            <tr><td>2000 kWh</td><td>29.8¢</td></tr>
          </table>
          <div>Average Price per Kilowatt-hour (¢ per kWh)</div>
          <div>Other Key Terms and Questions</div>
          <div>PUCT Certificate Number 10046</div>
          <div>Version Number REFE_Opendoor Select_Texas New Mexico Power_06162025</div>
          <p>${"Passed through TDU charges. ".repeat(80)}</p>
        </body>
      </html>
    `;

    globalThis.fetch = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as any;

    try {
      const extracted = __extractLikelyInlineEflTextForTest(html);
      expect(extracted).toBeTruthy();
      expect(extracted).toContain("Electricity Facts Label");
      expect(extracted).toContain("Version Number REFE_Opendoor Select_Texas New Mexico Power_06162025");

      const res = await fetchEflSourceFromUrl("https://wattbuy.com/product-document/spark-energy/153003/EFL");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.kind).toBe("raw_text");
        if (res.kind === "raw_text") {
          expect(res.rawText).toContain("Electricity Facts Label");
          expect(res.rawText).toContain("PUCT Certificate Number 10046");
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
