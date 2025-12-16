import { describe, expect, it } from "vitest";

import { __pickEflPdfCandidateUrlsFromHtmlForTest } from "@/lib/efl/fetchEflPdf";

describe("fetchEflPdf landing-page candidate selection (HTML heuristics)", () => {
  it("finds EFL PDF links when anchor text is present", () => {
    const html = `
      <html><body>
        <a href="/docs/efl.pdf">Electricity Facts Label</a>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://example.com/page");
    expect(out[0]).toContain("/docs/efl.pdf");
  });

  it("finds EFL PDF links when anchor text is empty but aria-label/title is set", () => {
    const html = `
      <html><body>
        <a href="/download/123" aria-label="Electricity Facts Label"> </a>
        <a href="/docs/other.pdf" title="Terms of Service">TOS</a>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://example.com/page");
    expect(out.some((u) => u.includes("/download/123"))).toBe(true);
  });

  it("finds PDF URLs in onclick handlers near EFL labels", () => {
    const html = `
      <html><body>
        <div aria-label="Electricity Facts Label" onclick="window.open('/docs/efl.pdf')"></div>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://example.com/page");
    expect(out[0]).toContain("/docs/efl.pdf");
  });

  it("finds PDF URLs embedded in script/JSON near the EFL label", () => {
    const html = `
      <html><body>
        <div>Electricity Facts Label</div>
        <script>
          window.__DATA__ = {"docs":{"efl":"https://cdn.example.com/plans/efl_123.pdf"}};
        </script>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://example.com/page");
    expect(out[0]).toContain("https://cdn.example.com/plans/efl_123.pdf");
  });

  it("finds non-.pdf EFL endpoints embedded in script/JSON (e.g., /Home/EFl)", () => {
    const html = `
      <html><body>
        <script>
          window.__NEXT_DATA__ = {"docs":{"efl":"https://signup.chariotenergy.com/Home/EFl?productId=40790&promo=14346"}};
        </script>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://example.com/page");
    expect(out.some((u) => u.includes("Home/EFl?productId=40790"))).toBe(true);
  });

  it("finds SmartGridCIS/OhmConnect Download.aspx EFL links by label text", () => {
    const html = `
      <html><body>
        <a href="https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx?ProductDocumentID=32831">
          Electricity Facts Label
        </a>
      </body></html>
    `;
    const out = __pickEflPdfCandidateUrlsFromHtmlForTest(html, "https://wattbuy.com/enrollment-form/x");
    expect(out[0]).toContain("Download.aspx?ProductDocumentID=32831");
  });
});


