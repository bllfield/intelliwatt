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

  it("does not confuse non-EFL bit.ly shortlinks as EFL during deep-scan fallback", () => {
    const raw = {
      offer_id: "wbdb-abc",
      offer_name: "Some Plan",
      offer_data: {
        supplier_name: "OhmConnect Energy",
        utility: "oncor",
        term: 12,
        tos: "https://bit.ly/3ZNResC",
        yrac: "https://bit.ly/3IT2R7Z",
        // Intentionally no offer_data.efl here.
      },
      // And no nested smartgridcis link either.
    };

    const n = normalizeOffer(raw);
    expect(n.docs.efl).toBe(null);
    expect(n.docs.tos).toBe("https://bit.ly/3ZNResC");
    expect(n.docs.yrac).toBe("https://bit.ly/3IT2R7Z");
  });

  it("keeps Companion hosted EFL URLs from offer_data", () => {
    const raw = {
      offer_id: "wbdb-zjanPnqv",
      offer_name: "Companion + Benefits 12",
      offer_data: {
        supplier_name: "Companion Energy",
        utility_name: "Oncor",
        term: 12,
        efl: "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=CEBENF12&tdspcode=ONCOR_ELEC",
        tos: "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=TOS",
        yrac: "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=YRAC",
      },
    };

    const n = normalizeOffer(raw);
    expect(n.docs.efl).toBe(
      "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=CEBENF12&tdspcode=ONCOR_ELEC",
    );
    expect(n.docs.tos).toBe(
      "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=TOS",
    );
    expect(n.docs.yrac).toBe(
      "https://eflviewer.companionenergy.com/eflviewer.aspx?lang=EN&prodcode=YRAC",
    );
  });

  it("keeps Rhythm offer-snapshot EFL URLs from offer_data.efl", () => {
    const raw = {
      offer_id: "wbdb-JlW2kww1",
      offer_name: "Simply Select 9",
      offer_data: {
        supplier_name: "Rhythm",
        utility: "Oncor Electric Delivery",
        term: 9,
        efl: "https://api.gotrhythm.com/api/v2/offer-snapshots/65fe73ee-d7cc-4539-9b6b-f0b97d340d78/efl/?locale=EN",
        tos: "https://cdn.gotrhythm.com/rhythm-tos-en-version-9.pdf",
        yrac: "https://cdn.gotrhythm.com/RhythmYRAC_en.pdf",
      },
    };

    const n = normalizeOffer(raw);
    expect(n.docs.efl).toBe(
      "https://api.gotrhythm.com/api/v2/offer-snapshots/65fe73ee-d7cc-4539-9b6b-f0b97d340d78/efl/?locale=EN",
    );
    expect(n.docs.tos).toBe("https://cdn.gotrhythm.com/rhythm-tos-en-version-9.pdf");
    expect(n.docs.yrac).toBe("https://cdn.gotrhythm.com/RhythmYRAC_en.pdf");
  });
});


