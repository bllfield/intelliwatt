import { describe, expect, it } from "vitest";

import { normalizeOffer } from "@/lib/wattbuy/normalize";

describe("wattbuy normalizeOffer - deep doc URL discovery", () => {
  it("discovers SmartGridCIS Download.aspx EFL URLs buried in nested fields", () => {
    const raw = {
      offer_id: "wbdb-xyz",
      offer_name: "Half-price Nights 12",
      offer_data: {
        supplier_name: "OhmConnect Energy",
        utility: "Oncor Electric Delivery",
        term: 12,
      },
      links: {
        efl: "https://ohm-gridlink.smartgridcis.net/Documents/Download.aspx?ProductDocumentID=32831",
      },
    };

    const n = normalizeOffer(raw);
    expect(n.docs.efl).toContain("Download.aspx?ProductDocumentID=32831");
  });

  it("keeps allowlisted shortlinks (bit.ly) for EFL docs so fetcher can follow redirects", () => {
    const raw = {
      offer_id: "wbdb-Px3gObj3",
      offer_name: "TexasConnect 12",
      offer_data: {
        supplier_name: "OhmConnect Energy",
        utility: "oncor",
        term: 12,
        efl: "https://bit.ly/3XL87ns",
      },
    };

    const n = normalizeOffer(raw);
    expect(n.docs.efl).toBe("https://bit.ly/3XL87ns");
  });
});


