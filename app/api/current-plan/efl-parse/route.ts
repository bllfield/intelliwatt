import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { deterministicEflExtract, extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";
import { parseEflText } from "@/lib/efl/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function toRateType(parsed: any): "FIXED" | "VARIABLE" | "TIME_OF_USE" {
  const tou = Array.isArray(parsed?.rate?.touWindowsJson) ? parsed.rate.touWindowsJson : [];
  if (tou.length > 0) return "TIME_OF_USE";
  if (parsed?.rate?.isVariable) return "VARIABLE";
  return "FIXED";
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!rawEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    const form = await req.formData();
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
          touWindows,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


