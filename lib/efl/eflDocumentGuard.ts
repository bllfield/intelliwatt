export type EflDocumentClassification =
  | {
      isEfl: true;
      reason: null;
      documentKind: "EFL";
    }
  | {
      isEfl: false;
      reason: string;
      documentKind: "TERMS_OF_SERVICE" | "YOUR_RIGHTS_AS_CUSTOMER" | "NON_EFL";
    };

function compactText(rawText: string): string {
  return String(rawText ?? "").replace(/\s+/g, " ").trim();
}

function firstMeaningfulLines(rawText: string, limit = 20): string {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("\n");
}

export function classifyEflDocument(rawText: string): EflDocumentClassification {
  const text = compactText(rawText);
  if (!text) {
    return {
      isEfl: false,
      documentKind: "NON_EFL",
      reason: "NON_EFL_DOCUMENT: empty raw text.",
    };
  }

  const firstLines = firstMeaningfulLines(rawText);

  const hasEflTitle = /\belectricity\s+facts\s+label\b/i.test(text);
  const hasAveragePriceTable =
    /\baverage\s+monthly\s+use\b/i.test(text) &&
    /\baverage\s+price\s+per\s+(?:kwh|kilowatt-hour)\b/i.test(text);
  const hasEflPricingSection =
    /\belectricity\s+price\b/i.test(text) &&
    /\b(?:energy|base|tdu|tdsp)\s+(?:charge|charges)\b/i.test(text);

  if (/\bterms\s+of\s+service\b/i.test(firstLines) && !hasAveragePriceTable) {
    return {
      isEfl: false,
      documentKind: "TERMS_OF_SERVICE",
      reason:
        "NON_EFL_DOCUMENT: extracted document appears to be Terms of Service, not an Electricity Facts Label.",
    };
  }

  if (/\byour\s+rights\s+as\s+a\s+customer\b|\byrac\b/i.test(firstLines) && !hasAveragePriceTable) {
    return {
      isEfl: false,
      documentKind: "YOUR_RIGHTS_AS_CUSTOMER",
      reason:
        "NON_EFL_DOCUMENT: extracted document appears to be Your Rights as a Customer, not an Electricity Facts Label.",
    };
  }

  if (hasEflTitle && (hasAveragePriceTable || hasEflPricingSection)) {
    return { isEfl: true, documentKind: "EFL", reason: null };
  }

  if (!hasAveragePriceTable && !hasEflPricingSection) {
    return {
      isEfl: false,
      documentKind: "NON_EFL",
      reason:
        "NON_EFL_DOCUMENT: extracted document does not contain EFL average-price or electricity-price sections.",
    };
  }

  return { isEfl: true, documentKind: "EFL", reason: null };
}

