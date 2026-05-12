import { describe, expect, it } from "vitest";

import { collectOfferEflCandidateUrls, normalizeOffer } from "@/lib/wattbuy/normalize";

describe("collectOfferEflCandidateUrls", () => {
  it("keeps multiple distinct EFL candidates in priority order", () => {
    const raw = {
      offer_id: "wbdb-bevLMnOe",
      offer_name: "Opendoor Select",
      link: "https://wattbuy.com/electricity/texas/electricity-plans/wbdb-bevLMnOe/enroll/",
      offer_data: {
        efl: "https://wattbuy.com/product-document/spark-energy/153002/EFL",
        utility: "oncor",
        supplier_name: "Spark Energy",
        documents: {
          electricityFactsLabel:
            "https://wattbuy.com/product-document/spark-energy/153002/EFL?source=documents",
        },
        nested: {
          efl_pdf:
            "https://wattbuy.com/product-document/spark-energy/153002/EFL?source=nested",
        },
      },
    };

    const offer = normalizeOffer(raw);
    const candidates = collectOfferEflCandidateUrls(offer);

    expect(candidates).toEqual([
      "https://wattbuy.com/product-document/spark-energy/153002/EFL",
      "https://wattbuy.com/product-document/spark-energy/153002/EFL?source=documents",
      "https://wattbuy.com/product-document/spark-energy/153002/EFL?source=nested",
      "https://wattbuy.com/electricity/texas/electricity-plans/wbdb-bevLMnOe/enroll/",
    ]);
  });
});
