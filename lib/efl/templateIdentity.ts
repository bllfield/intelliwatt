export type EflTemplateKeyType =
  | "PUCT_CERT_PLUS_EFL_VERSION"
  | "EFL_PDF_SHA256"
  | "WATTBUY_FALLBACK";

export interface EflTemplateKeyInput {
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string | null;
  wattbuy?:
    | {
        providerName?: string | null;
        planName?: string | null;
        termMonths?: number | null;
        tdspName?: string | null;
        offerId?: string | null;
      }
    | null;
}

export interface EflTemplateKeyResult {
  primaryKey: string;
  keyType: EflTemplateKeyType;
  confidence: number; // 0..100 deterministic
  lookupKeys: string[]; // includes primary first, then weaker keys
  warnings: string[];
}

function normalizeIdentityString(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  // Strip non-alphanumeric except whitespace, then collapse spaces.
  const stripped = lower.replace(/[^a-z0-9\s]/g, " ");
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  return collapsed || null;
}

export function getTemplateKey(opts: EflTemplateKeyInput): EflTemplateKeyResult {
  const warnings: string[] = [];
  const lookupKeys: string[] = [];

  const rep = normalizeIdentityString(opts.repPuctCertificate);
  const ver = normalizeIdentityString(opts.eflVersionCode);
  const sha = opts.eflPdfSha256?.trim() || null;

  // 1) Strongest: REP PUCT Certificate + EFL Version Code (Ver. #).
  if (rep && ver) {
    const primaryKey = `puct:${rep}|ver:${ver}`;
    const keyType: EflTemplateKeyType = "PUCT_CERT_PLUS_EFL_VERSION";
    const confidence = 95;

    lookupKeys.push(primaryKey);
    if (sha) {
      lookupKeys.push(`sha256:${sha}`);
    }

    return {
      primaryKey,
      keyType,
      confidence,
      lookupKeys,
      warnings,
    };
  }

  // 2) Next-best: SHA-256 of the EFL PDF bytes.
  if (sha) {
    const primaryKey = `sha256:${sha}`;
    const keyType: EflTemplateKeyType = "EFL_PDF_SHA256";
    const confidence = 85;

    lookupKeys.push(primaryKey);

    // Include WattBuy-style fallback identity as a weaker secondary key if present.
    const wb = opts.wattbuy;
    if (wb) {
      const provider = normalizeIdentityString(wb.providerName) ?? "na";
      const plan = normalizeIdentityString(wb.planName) ?? "na";
      const term =
        typeof wb.termMonths === "number" && Number.isFinite(wb.termMonths)
          ? String(wb.termMonths)
          : "na";
      const tdsp = normalizeIdentityString(wb.tdspName) ?? "na";
      const offer = wb.offerId?.trim() || "na";

      const fallbackKey = `wb:${provider}|plan:${plan}|term:${term}|tdsp:${tdsp}|offer:${offer}`;
      lookupKeys.push(fallbackKey);
    }

    return {
      primaryKey,
      keyType,
      confidence,
      lookupKeys,
      warnings,
    };
  }

  // 3) WattBuy-style fallback identity when we do not yet have SHA or PUCT+Ver.
  const wb = opts.wattbuy;
  const provider = normalizeIdentityString(wb?.providerName) ?? "na";
  const plan = normalizeIdentityString(wb?.planName) ?? "na";
  const term =
    wb && typeof wb.termMonths === "number" && Number.isFinite(wb.termMonths)
      ? String(wb.termMonths)
      : "na";
  const tdsp = normalizeIdentityString(wb?.tdspName) ?? "na";
  const offer = wb?.offerId?.trim() || "na";

  const primaryKey = `wb:${provider}|plan:${plan}|term:${term}|tdsp:${tdsp}|offer:${offer}`;
  const keyType: EflTemplateKeyType = "WATTBUY_FALLBACK";
  const confidence = 55;

  warnings.push(
    "Template identity using WattBuy fallback; may dedupe imperfectly until PUCT+Ver or sha256 available.",
  );

  lookupKeys.push(primaryKey);

  return {
    primaryKey,
    keyType,
    confidence,
    lookupKeys,
    warnings,
  };
}


