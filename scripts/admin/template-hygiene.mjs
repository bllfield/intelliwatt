import { PrismaClient, Prisma } from "@prisma/client";

function hasDatabaseUrl() {
  const v = process.env.DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
}

function normStr(v) {
  return String(v ?? "").trim();
}

function isJsonNullLike(v) {
  return v === null || v === Prisma.DbNull || v === Prisma.JsonNull || v === Prisma.AnyNull;
}

function isRateStructurePresent(rs) {
  if (isJsonNullLike(rs)) return false;
  if (typeof rs !== "object") return false;
  try {
    return Object.keys(rs).length > 0;
  } catch {
    return false;
  }
}

function missingIdentityFields(rp) {
  const missing = [];
  if (!normStr(rp.repPuctCertificate)) missing.push("repPuctCertificate");
  if (!normStr(rp.eflVersionCode)) missing.push("eflVersionCode");
  if (!normStr(rp.eflPdfSha256)) missing.push("eflPdfSha256");
  if (!normStr(rp.supplier)) missing.push("supplier");
  if (!normStr(rp.planName)) missing.push("planName");
  if (typeof rp.termMonths !== "number") missing.push("termMonths");
  return missing;
}

async function main() {
  console.log(`DATABASE_URL set? ${hasDatabaseUrl() ? "yes" : "no"}`);
  if (!hasDatabaseUrl()) {
    console.error("Missing DATABASE_URL env var. Set it in your PowerShell session before running this script.");
    process.exitCode = 1;
    return;
  }

  // Safe by default: does NOT write unless APPLY=1.
  const APPLY = String(process.env.APPLY ?? "").trim() === "1";
  const LIMIT = Math.max(1, Math.min(5000, Number(process.env.LIMIT ?? "500") || 500));

  const prisma = new PrismaClient();
  try {
    // Candidates: “template-like” rows (rateStructure present) that are missing identity,
    // or already marked manual-review. These are common legacy/junk templates that pollute admin views.
    const candidates = await prisma.ratePlan.findMany({
      where: {
        isUtilityTariff: false,
        OR: [
          { eflRequiresManualReview: true },
          { repPuctCertificate: null },
          { eflVersionCode: null },
          { eflPdfSha256: null },
          { supplier: null },
          { planName: null },
          { termMonths: null },
        ],
      },
      select: {
        id: true,
        supplier: true,
        planName: true,
        termMonths: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflPdfSha256: true,
        eflUrl: true,
        eflSourceUrl: true,
        eflRequiresManualReview: true,
        rateStructure: true,
        planCalcStatus: true,
        planCalcReasonCode: true,
        requiredBucketKeys: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    });

    const rows = [];
    let scanned = 0;
    let templatePresent = 0;
    let linkedToOffers = 0;
    let orphanJunk = 0;
    let applied = 0;

    for (const rp of candidates) {
      scanned++;
      const rsPresent = isRateStructurePresent(rp.rateStructure);
      if (!rsPresent) continue;
      templatePresent++;

      const missing = missingIdentityFields(rp);
      const linkedCount = await prisma.offerIdRatePlanMap.count({
        where: { ratePlanId: String(rp.id) },
      });

      if (linkedCount > 0) linkedToOffers++;

      const isJunk = missing.length > 0 || rp.eflRequiresManualReview === true;
      const orphan = linkedCount === 0;

      const action =
        isJunk && orphan
          ? "INVALIDATE_ORPHAN"
          : isJunk && !orphan
            ? "KEEP_NEEDS_REPARSE"
            : "KEEP_OK";

      if (action === "INVALIDATE_ORPHAN") orphanJunk++;

      if (APPLY && action === "INVALIDATE_ORPHAN") {
        // “Invalidate” = remove template usability signals so it won’t be treated as a usable template hit.
        // We keep identity fields as-is (even if partial) for auditability.
        await prisma.ratePlan.update({
          where: { id: String(rp.id) },
          data: {
            rateStructure: Prisma.DbNull,
            eflRequiresManualReview: true,
            eflValidationIssues: Prisma.DbNull,
            modeledEflAvgPriceValidation: Prisma.DbNull,
            modeledComputedAt: null,
            planCalcStatus: "UNKNOWN",
            planCalcReasonCode: "MISSING_TEMPLATE",
            requiredBucketKeys: [],
            planCalcDerivedAt: null,
          },
        });
        applied++;
      }

      rows.push({
        id: String(rp.id),
        linkedOfferCount: linkedCount,
        action,
        missingIdentityFields: missing,
        supplier: rp.supplier ?? null,
        planName: rp.planName ?? null,
        termMonths: typeof rp.termMonths === "number" ? rp.termMonths : null,
        repPuctCertificate: rp.repPuctCertificate ?? null,
        eflVersionCode: rp.eflVersionCode ?? null,
        eflPdfSha256: rp.eflPdfSha256 ?? null,
        eflUrl: rp.eflUrl ?? null,
        eflSourceUrl: rp.eflSourceUrl ?? null,
        eflRequiresManualReview: Boolean(rp.eflRequiresManualReview),
        planCalcStatus: rp.planCalcStatus ?? null,
        planCalcReasonCode: rp.planCalcReasonCode ?? null,
        requiredBucketKeysCount: Array.isArray(rp.requiredBucketKeys) ? rp.requiredBucketKeys.length : 0,
      });
    }

    const summary = {
      apply: APPLY,
      limit: LIMIT,
      scannedCandidates: scanned,
      templateRateStructurePresent: templatePresent,
      linkedToOffers,
      orphanJunk,
      appliedInvalidations: applied,
      note:
        "Orphan junk templates are invalidated by clearing rateStructure + forcing manual review. Linked templates are never invalidated by this script (they are reported as KEEP_NEEDS_REPARSE).",
    };

    console.log(JSON.stringify({ summary, rows: rows.slice(0, 300) }, null, 2));
    if (rows.length > 300) {
      console.log(`(truncated output: showing first 300 rows of ${rows.length})`);
    }
  } catch (err) {
    console.error("template-hygiene failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();

