import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";
import { deterministicEflExtract, extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";
import { parseEflText } from "@/lib/efl/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// EFL extraction can be slow (pdftotext service + fallbacks). Allow long-running serverless execution.
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function normalizeHhMm(v: any): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  // Accept "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [hhRaw, mmRaw] = s.split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  // Accept "HHMM"
  if (/^\d{3,4}$/.test(s)) {
    const padded = s.padStart(4, "0");
    const hh = Number(padded.slice(0, 2));
    const mm = Number(padded.slice(2, 4));
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

function toRateType(parsed: any): "FIXED" | "VARIABLE" | "TIME_OF_USE" {
  const tou = Array.isArray(parsed?.rate?.touWindowsJson) ? parsed.rate.touWindowsJson : [];
  if (tou.length > 0) return "TIME_OF_USE";
  if (parsed?.rate?.isVariable) return "VARIABLE";
  return "FIXED";
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json({ ok: false, error: "CURRENT_PLAN_DATABASE_URL is not configured" }, { status: 500 });
    }

    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!rawEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    const form = await req.formData();
    const houseIdRaw = form.get("houseId");
    const houseId =
      typeof houseIdRaw === "string" && houseIdRaw.trim().length > 0 ? houseIdRaw.trim() : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });
      if (!ownsHouse) {
        return NextResponse.json({ ok: false, error: "houseId does not belong to the current user" }, { status: 403 });
      }
    }

    const f = form.get("eflFile");
    if (!(f instanceof File)) {
      return NextResponse.json({ ok: false, error: "eflFile_required" }, { status: 400 });
    }

    const name = (f.name ?? "").toLowerCase();
    const type = (f.type ?? "").toLowerCase();
    const isPdf = type === "application/pdf" || name.endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ ok: false, error: "pdf_only" }, { status: 400 });
    }

    const ab = await f.arrayBuffer();
    if (!ab || ab.byteLength <= 0) {
      return NextResponse.json({ ok: false, error: "empty_file" }, { status: 400 });
    }
    if (ab.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    const pdfBytes = Buffer.from(ab);

    // Canonical PDF → text extraction (same pipeline used by EFL processing).
    const det = await deterministicEflExtract(pdfBytes);
    const rawText = det.rawText ?? "";
    if (!rawText.trim()) {
      return NextResponse.json(
        { ok: false, error: "efl_text_empty", warnings: det.warnings ?? [] },
        { status: 422 },
      );
    }

    const labels = extractProviderAndPlanNameFromEflText(rawText);
    const parsed = parseEflText(rawText, {
      supplierName: labels.providerName,
      planName: labels.planName,
    } as any);

    const rateType = toRateType(parsed);
    const centsBands = Array.isArray(parsed?.rate?.centsPerKwhJson) ? parsed.rate.centsPerKwhJson : [];
    const flatEnergyRateCents =
      centsBands.length === 1 && centsBands[0] && typeof centsBands[0].cents === "number"
        ? centsBands[0].cents
        : null;

    const billCredits = Array.isArray(parsed?.rate?.billCreditsJson) ? parsed.rate.billCreditsJson : [];
    const touWindows = Array.isArray(parsed?.rate?.touWindowsJson) ? parsed.rate.touWindowsJson : [];

    // Normalize TOU time strings to HH:MM so saving doesn't fail validation later.
    const touWindowsNormalized = touWindows
      .map((t: any) => {
        const start = normalizeHhMm(t?.start);
        const end = normalizeHhMm(t?.end);
        const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
        if (!start || !end || cents == null) return null;
        return { ...t, start, end, cents };
      })
      .filter(Boolean) as any[];

    // Persist in current-plan module DB so it shows up in /api/current-plan/init and can be reviewed later.
    const currentPlanPrisma = getCurrentPlanPrisma();
    const uploadRow = await (currentPlanPrisma as any).currentPlanBillUpload.create({
      data: {
        userId: user.id,
        houseId,
        filename: `EFL:${String(f.name ?? "efl.pdf").slice(0, 240)}`,
        mimeType: "application/pdf",
        sizeBytes: pdfBytes.length,
        billData: pdfBytes,
      },
      select: { id: true },
    });

    // Build a CurrentPlan-style rateStructure for transparency + later calculations.
    // (Matches the shape validated by /api/current-plan/manual.)
    const rateStructure: any = (() => {
      const baseMonthlyFeeCents =
        typeof parsed?.rate?.baseMonthlyFeeCents === "number" && Number.isFinite(parsed.rate.baseMonthlyFeeCents)
          ? Math.round(parsed.rate.baseMonthlyFeeCents)
          : null;

      const credits = Array.isArray(billCredits) ? billCredits : [];
      const billCreditsObj =
        credits.length > 0
          ? {
              hasBillCredit: true,
              rules: credits
                .map((c: any) => ({
                  label: typeof c?.label === "string" ? c.label : "Bill credit",
                  creditAmountCents:
                    typeof c?.creditCents === "number" && Number.isFinite(c.creditCents) ? Math.round(c.creditCents) : 0,
                  minUsageKWh:
                    typeof c?.thresholdKwh === "number" && Number.isFinite(c.thresholdKwh) ? Math.round(c.thresholdKwh) : 0,
                  maxUsageKWh: null,
                  monthsOfYear: null,
                }))
                .filter((x: any) => x.creditAmountCents > 0 && x.minUsageKWh > 0),
            }
          : { hasBillCredit: false, rules: [] };

      if (rateType === "TIME_OF_USE") {
        const tiers = (touWindowsNormalized.length ? touWindowsNormalized : touWindows)
          .map((t: any, idx: number) => {
            const start = normalizeHhMm(t?.start);
            const end = normalizeHhMm(t?.end);
            const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
            if (!start || !end || cents == null) return null;
            return {
              label: typeof t?.label === "string" && t.label.trim() ? t.label.trim() : `Period ${idx + 1}`,
              priceCents: Number(cents.toFixed(4)),
              startTime: start,
              endTime: end,
              daysOfWeek: "ALL",
            };
          })
          .filter(Boolean);

        return {
          type: "TIME_OF_USE",
          ...(baseMonthlyFeeCents != null && baseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents } : {}),
          tiers,
          billCredits: billCreditsObj,
        };
      }

      if (rateType === "VARIABLE") {
        return {
          type: "VARIABLE",
          currentBillEnergyRateCents: flatEnergyRateCents != null ? Number(flatEnergyRateCents.toFixed(4)) : null,
          ...(baseMonthlyFeeCents != null && baseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents } : {}),
          billCredits: billCreditsObj,
        };
      }

      return {
        type: "FIXED",
        ...(flatEnergyRateCents != null ? { energyRateCents: Number(flatEnergyRateCents.toFixed(4)) } : {}),
        ...(baseMonthlyFeeCents != null && baseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents } : {}),
        billCredits: billCreditsObj,
      };
    })();

    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;
    const existing = await parsedDelegate.findFirst({
      where: { userId: user.id, houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const entryData = {
      userId: user.id,
      houseId,
      uploadId: uploadRow.id,
      rawText: rawText.slice(0, 250_000),
      rawTextSnippet: rawText.slice(0, 5000),
      providerName: labels.providerName ?? parsed?.rate?.supplierName ?? null,
      planName: labels.planName ?? parsed?.rate?.planName ?? null,
      rateType,
      termMonths: typeof parsed?.rate?.termMonths === "number" ? parsed.rate.termMonths : null,
      termLengthMonths: typeof parsed?.rate?.termMonths === "number" ? parsed.rate.termMonths : null,
      energyRateTiersJson: null,
      timeOfUseConfigJson: touWindowsNormalized.length ? touWindowsNormalized : touWindows,
      billCreditsJson: billCredits,
      rateStructure,
      parserVersion: "current-plan-efl-v1",
      confidenceScore: null,
    };

    const record =
      existing
        ? await parsedDelegate.update({ where: { id: existing.id }, data: entryData })
        : await parsedDelegate.create({ data: entryData });

    // Quarantine into the shared EFL review queue when parsing is incomplete/unsupported.
    const warnings: string[] = [
      ...((det.warnings ?? []) as any[]).map((x) => String(x)),
      ...(((parsed?.meta?.warnings ?? []) as any[]) ?? []).map((x) => String(x)),
    ].filter(Boolean);

    const reasonParts: string[] = [];
    if (!entryData.providerName) reasonParts.push("missing_provider");
    if (!entryData.planName) reasonParts.push("missing_plan_name");
    if (rateType !== "TIME_OF_USE" && flatEnergyRateCents == null) reasonParts.push("missing_flat_energy_rate");
    if (rateType === "TIME_OF_USE" && (!Array.isArray((rateStructure as any)?.tiers) || (rateStructure as any).tiers.length === 0)) {
      reasonParts.push("missing_tou_tiers");
    }
    if (warnings.length) reasonParts.push("warnings_present");

    const needsReview = reasonParts.length > 0;
    if (needsReview) {
      const queueReason = `CURRENT_PLAN_EFL: ${reasonParts.join(", ")}${warnings.length ? `\nwarnings: ${warnings.join(" | ")}` : ""}`;
      try {
        const rateAny = (parsed as any)?.rate ?? null;
        await (prisma as any).eflParseReviewQueue.upsert({
          where: { eflPdfSha256: det.eflPdfSha256 },
          create: {
            source: "current_plan_efl",
            kind: "EFL_PARSE",
            dedupeKey: `current_plan:${det.eflPdfSha256}`,
            eflPdfSha256: det.eflPdfSha256,
            repPuctCertificate: rateAny?.repPuctCertificate ?? rateAny?.rep_puct_certificate ?? null,
            eflVersionCode: rateAny?.eflVersionCode ?? rateAny?.efl_version_code ?? null,
            offerId: null,
            supplier: entryData.providerName,
            planName: entryData.planName,
            eflUrl: null,
            tdspName: null,
            termMonths: entryData.termMonths,
            rawText: rawText.slice(0, 250_000),
            planRules: rateAny?.planRulesJson ?? rateAny?.plan_rules_json ?? null,
            rateStructure: rateAny?.rateStructureJson ?? rateAny?.rate_structure_json ?? null,
            validation: null,
            derivedForValidation: null,
            finalStatus: "FAIL",
            queueReason,
            solverApplied: null,
          },
          update: {
            updatedAt: new Date(),
            source: "current_plan_efl",
            kind: "EFL_PARSE",
            dedupeKey: `current_plan:${det.eflPdfSha256}`,
            supplier: entryData.providerName,
            planName: entryData.planName,
            termMonths: entryData.termMonths,
            rawText: rawText.slice(0, 250_000),
            planRules: rateAny?.planRulesJson ?? rateAny?.plan_rules_json ?? null,
            rateStructure: rateAny?.rateStructureJson ?? rateAny?.rate_structure_json ?? null,
            finalStatus: "FAIL",
            queueReason,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
        });
      } catch {
        // Best-effort only; never break the customer flow.
      }
    }

    return NextResponse.json(
      {
        ok: true,
        extractedFrom: "EFL_PDF",
        eflPdfSha256: det.eflPdfSha256,
        extractorMethod: (det as any)?.extractorMethod ?? null,
        warnings: det.warnings ?? [],
        parsedWarnings: (parsed?.meta?.warnings ?? []) as string[],
        notes: (parsed?.meta?.notes ?? []) as string[],
        rawTextPreview: rawText.slice(0, 5000),
        savedParsedCurrentPlanId: record?.id ?? null,
        queuedForReview: needsReview,
        prefill: {
          providerName: labels.providerName ?? parsed?.rate?.supplierName ?? null,
          planName: labels.planName ?? parsed?.rate?.planName ?? null,
          rateType,
          termLengthMonths: typeof parsed?.rate?.termMonths === "number" ? parsed.rate.termMonths : null,
          energyRateCentsPerKwh: flatEnergyRateCents,
          baseMonthlyFeeDollars:
            typeof parsed?.rate?.baseMonthlyFeeCents === "number" ? parsed.rate.baseMonthlyFeeCents / 100 : null,
          earlyTerminationFeeDollars:
            typeof parsed?.rate?.cancelFeeCents === "number" ? parsed.rate.cancelFeeCents / 100 : null,
          avgPricesCentsPerKwh: {
            kwh500: typeof parsed?.rate?.avgPrice500 === "number" ? parsed.rate.avgPrice500 : null,
            kwh1000: typeof parsed?.rate?.avgPrice1000 === "number" ? parsed.rate.avgPrice1000 : null,
            kwh2000: typeof parsed?.rate?.avgPrice2000 === "number" ? parsed.rate.avgPrice2000 : null,
          },
          billCredits,
          touWindows: touWindowsNormalized.length ? touWindowsNormalized : touWindows,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


