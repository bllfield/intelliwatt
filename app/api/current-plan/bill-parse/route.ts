import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import crypto from 'node:crypto';
import {
  extractCurrentPlanFromBillText,
  extractCurrentPlanFromBillTextWithOpenAI,
  type ParsedCurrentPlanPayload,
} from '@/lib/billing/parseBillText';
import { extractBillTextFromUpload } from '@/lib/billing/extractBillText';

export const dynamic = 'force-dynamic';
// Bill parsing can be slow (pdf-to-text + optional AI). Allow long-running serverless execution.
export const maxDuration = 300;

function sha256Hex(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const decimalFromNumber = (
  value: number,
  precision: number,
  scale: number,
): CurrentPlanPrisma.Decimal => {
  const multiplier = 10 ** scale;
  const rounded = Math.round(value * multiplier) / multiplier;
  return new CurrentPlanPrisma.Decimal(rounded.toFixed(scale));
};

function normalizeKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function applyTemplateToParsed(
  parsed: ParsedCurrentPlanPayload,
  template: any,
): ParsedCurrentPlanPayload {
  return {
    ...parsed,
    providerName: template.providerName ?? parsed.providerName ?? null,
    planName: template.planName ?? parsed.planName ?? null,
    rateType: (template.rateType as any) ?? parsed.rateType ?? null,
    variableIndexType: template.variableIndexType ?? parsed.variableIndexType ?? null,
    termMonths: template.termMonths ?? parsed.termMonths ?? null,
    contractEndDate: template.contractEndDate
      ? (template.contractEndDate as Date).toISOString().slice(0, 10)
      : parsed.contractEndDate ?? null,
    earlyTerminationFeeCents:
      template.earlyTerminationFeeCents ?? parsed.earlyTerminationFeeCents ?? null,
    baseChargeCentsPerMonth:
      template.baseChargeCentsPerMonth ?? parsed.baseChargeCentsPerMonth ?? null,
    energyRateTiers:
      (template.energyRateTiersJson as any) ?? parsed.energyRateTiers ?? parsed.energyRateTiers,
    timeOfUse:
      (template.timeOfUseConfigJson as any) ?? parsed.timeOfUse ?? parsed.timeOfUse,
    billCredits:
      (template.billCreditsJson as any) ?? parsed.billCredits ?? parsed.billCredits,
  };
}

export async function POST(request: NextRequest) {
  let debugUploadId: string | null = null;
  let debugHouseId: string | null = null;
  let debugRawText: string | null = null;
  let debugBillSha: string | null = null;
  let debugParsed: any = null;
  let debugBaseline: any = null;
  let debugUsedAi = false;
  try {
    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json(
        { error: 'CURRENT_PLAN_DATABASE_URL is not configured' },
        { status: 500 },
      );
    }

    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value ?? null;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { houseId?: unknown; uploadId?: unknown; textOverride?: unknown }
      | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const houseIdRaw = body.houseId;
    const uploadIdRaw = body.uploadId;
    const textOverride =
      typeof body.textOverride === 'string' && body.textOverride.trim().length > 0
        ? body.textOverride
        : null;

    const houseId =
      typeof houseIdRaw === 'string' && houseIdRaw.trim().length > 0
        ? houseIdRaw.trim()
        : null;

    // If a houseId is provided, verify ownership. For flows that do not yet have
    // a resolved house (e.g., initial current-plan dashboard uploads), we allow
    // houseId to be null and rely solely on the authenticated user.
    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });

      if (!ownsHouse) {
        return NextResponse.json(
          { error: 'houseId does not belong to the current user' },
          { status: 403 },
        );
      }
    }

    const currentPlanPrisma = getCurrentPlanPrisma();

    let uploadRecord:
      | { id: string; filename: string; mimeType: string; billData: Buffer }
      | null = null;

    if (!textOverride) {
      const billDelegate = currentPlanPrisma.currentPlanBillUpload as any;

      if (uploadIdRaw && typeof uploadIdRaw === 'string' && uploadIdRaw.trim().length > 0) {
        uploadRecord = await billDelegate.findFirst({
          where: {
            id: uploadIdRaw.trim(),
            userId: user.id,
            ...(houseId ? { houseId } : {}),
          },
          select: { id: true, filename: true, mimeType: true, billData: true },
        });
      }

      if (!uploadRecord) {
        uploadRecord = await billDelegate.findFirst({
          where: {
            userId: user.id,
            ...(houseId ? { houseId } : {}),
          },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, filename: true, mimeType: true, billData: true },
        });
      }

      if (!uploadRecord) {
        return NextResponse.json(
          {
            error:
              'No uploaded bill found for this account. Upload a PDF on the dashboard first or paste the bill text.',
          },
          { status: 404 },
        );
      }
    }

    let text = textOverride;

    if (!text) {
      const billDelegate = currentPlanPrisma.currentPlanBillUpload as any;
      const fullUpload = await billDelegate.findFirst({
        where: { id: uploadRecord!.id },
      });
      text = await extractBillTextFromUpload(fullUpload);
    }

    if (!text || !text.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Could not extract text from uploaded bill file.' },
        { status: 422 },
      );
    }

    debugHouseId = houseId ?? null;
    debugUploadId = uploadRecord?.id ?? null;
    debugRawText = text;
    debugBillSha = uploadRecord?.billData ? sha256Hex(uploadRecord.billData) : sha256Hex(`text:${text}`);

    // 1) Baseline parse (regex-only)
    const baseline = extractCurrentPlanFromBillText(text, {});
    debugBaseline = baseline;

    // 2) Try to find a template based on providerName + planName from baseline
    let providerNameKey = normalizeKey(baseline.providerName);
    let planNameKey = normalizeKey(baseline.planName);

    const templateDelegate = (currentPlanPrisma as any).billPlanTemplate as any;

    let parsed: ParsedCurrentPlanPayload;
    let existingTemplate: any = null;

    if (templateDelegate && providerNameKey && planNameKey) {
      existingTemplate = await templateDelegate.findUnique({
        where: {
          providerNameKey_planNameKey: {
            providerNameKey,
            planNameKey,
          },
        },
      });
    }

    if (existingTemplate) {
      parsed = applyTemplateToParsed(baseline, existingTemplate);
    } else {
      const aiParsed = await extractCurrentPlanFromBillTextWithOpenAI(text, {});
      debugUsedAi = true;
      parsed = aiParsed;

      providerNameKey = normalizeKey(parsed.providerName ?? baseline.providerName);
      planNameKey = normalizeKey(parsed.planName ?? baseline.planName);

      if (templateDelegate && providerNameKey && planNameKey) {
        try {
          await templateDelegate.upsert({
            where: {
              providerNameKey_planNameKey: {
                providerNameKey,
                planNameKey,
              },
            },
            update: {
              providerName: parsed.providerName ?? baseline.providerName ?? null,
              planName: parsed.planName ?? baseline.planName ?? null,
              rateType: parsed.rateType ?? baseline.rateType ?? null,
              variableIndexType:
                parsed.variableIndexType ?? baseline.variableIndexType ?? null,
              termMonths: parsed.termMonths ?? baseline.termMonths ?? null,
              contractEndDate: parsed.contractEndDate
                ? new Date(parsed.contractEndDate)
                : null,
              earlyTerminationFeeCents:
                parsed.earlyTerminationFeeCents ?? baseline.earlyTerminationFeeCents ?? null,
              baseChargeCentsPerMonth:
                parsed.baseChargeCentsPerMonth ?? baseline.baseChargeCentsPerMonth ?? null,
              energyRateTiersJson:
                parsed.energyRateTiers ?? baseline.energyRateTiers ?? [],
              timeOfUseConfigJson: parsed.timeOfUse ?? baseline.timeOfUse ?? null,
              billCreditsJson:
                parsed.billCredits ??
                baseline.billCredits ?? { enabled: false, rules: [] },
            },
            create: {
              providerNameKey,
              planNameKey,
              providerName: parsed.providerName ?? baseline.providerName ?? null,
              planName: parsed.planName ?? baseline.planName ?? null,
              rateType: parsed.rateType ?? baseline.rateType ?? null,
              variableIndexType:
                parsed.variableIndexType ?? baseline.variableIndexType ?? null,
              termMonths: parsed.termMonths ?? baseline.termMonths ?? null,
              contractEndDate: parsed.contractEndDate
                ? new Date(parsed.contractEndDate)
                : null,
              earlyTerminationFeeCents:
                parsed.earlyTerminationFeeCents ?? baseline.earlyTerminationFeeCents ?? null,
              baseChargeCentsPerMonth:
                parsed.baseChargeCentsPerMonth ?? baseline.baseChargeCentsPerMonth ?? null,
              energyRateTiersJson:
                parsed.energyRateTiers ?? baseline.energyRateTiers ?? [],
              timeOfUseConfigJson: parsed.timeOfUse ?? baseline.timeOfUse ?? null,
              billCreditsJson:
                parsed.billCredits ??
                baseline.billCredits ?? { enabled: false, rules: [] },
            },
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[current-plan/bill-parse] Failed to upsert BillPlanTemplate', e);
        }
      }
    }

    debugParsed = parsed;

    const decimalOrNull = (value: number | null | undefined, scale: number) => {
      if (value === null || value === undefined) return null;
      return decimalFromNumber(value, 8, scale);
    };

    const entryData: any = {
      userId: user.id,
      houseId,
      sourceUploadId: uploadRecord?.id ?? null,
      uploadId: uploadRecord?.id ?? null,
      rawText: parsed.rawText,
      rawTextSnippet: parsed.rawText.slice(0, 4000),
      esiid: parsed.esiid,
      meterNumber: parsed.meterNumber,
      providerName: parsed.providerName,
      tdspName: parsed.tdspName,
      accountNumber: parsed.accountNumber,
      // Normalize into helper fields used by downstream UIs.
      esiId: parsed.esiid,
      accountNumberLast4:
        parsed.accountNumber && parsed.accountNumber.length > 0
          ? parsed.accountNumber.slice(-4)
          : null,
      customerName: parsed.customerName,
      serviceAddressLine1: parsed.serviceAddressLine1,
      serviceAddressLine2: parsed.serviceAddressLine2,
      serviceAddressCity: parsed.serviceAddressCity,
      serviceAddressState: parsed.serviceAddressState,
      serviceAddressZip: parsed.serviceAddressZip,
      rateType: parsed.rateType,
      variableIndexType: parsed.variableIndexType,
      planName: parsed.planName,
      termMonths: parsed.termMonths,
      termLengthMonths: parsed.termMonths,
      contractStartDate: parsed.contractStartDate
        ? new Date(parsed.contractStartDate)
        : null,
      contractEndDate: parsed.contractEndDate ? new Date(parsed.contractEndDate) : null,
      earlyTerminationFeeCents: parsed.earlyTerminationFeeCents,
      baseChargeCentsPerMonth: parsed.baseChargeCentsPerMonth,
      energyRateTiersJson: parsed.energyRateTiers,
      timeOfUseConfigJson: parsed.timeOfUse,
      billCreditsJson: parsed.billCredits,
      billingPeriodStart: parsed.billingPeriodStart
        ? new Date(parsed.billingPeriodStart)
        : null,
      billingPeriodEnd: parsed.billingPeriodEnd
        ? new Date(parsed.billingPeriodEnd)
        : null,
      billIssueDate: parsed.billIssueDate ? new Date(parsed.billIssueDate) : null,
      billDueDate: parsed.billDueDate ? new Date(parsed.billDueDate) : null,
      totalAmountDueCents: parsed.totalAmountDueCents,
      parserVersion: process.env.OPENAI_IntelliWatt_Bill_Parcer ? 'bill-text-v3-json' : 'bill-text-v1-regex',
      confidenceScore: null,
    };

    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;

    const existing = await parsedDelegate.findFirst({
      where: { userId: user.id, houseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const saved =
      existing &&
      (await parsedDelegate.update({
        where: { id: existing.id },
        data: entryData,
      }));

    const created =
      !existing &&
      (await parsedDelegate.create({
        data: entryData,
      }));

    const record = (saved ?? created) as any;

    // Queue if we failed to extract key fields (so admin can iterate on regex/templates).
    const reasonParts: string[] = [];
    const providerOk = typeof parsed?.providerName === 'string' && parsed.providerName.trim().length > 0;
    const planOk = typeof parsed?.planName === 'string' && parsed.planName.trim().length > 0;
    const rateTypeOk = typeof parsed?.rateType === 'string' && parsed.rateType.trim().length > 0;
    const esiidOk = typeof parsed?.esiid === 'string' && parsed.esiid.trim().length > 0;
    const meterOk = typeof parsed?.meterNumber === 'string' && parsed.meterNumber.trim().length > 0;

    if (!providerOk) reasonParts.push('missing_provider');
    if (!planOk) reasonParts.push('missing_plan_name');
    if (!rateTypeOk) reasonParts.push('missing_rate_type');
    if (!esiidOk && !meterOk) reasonParts.push('missing_esiid_or_meter');

    // Fixed/Variable plans usually need a usable energy rate signal.
    const rt = String(parsed?.rateType ?? '').toUpperCase();
    const hasEnergyTiers = Array.isArray(parsed?.energyRateTiers) && parsed.energyRateTiers.length > 0;
    const hasTou = Array.isArray(parsed?.timeOfUse) && parsed.timeOfUse.length > 0;
    if ((rt === 'FIXED' || rt === 'VARIABLE') && !hasEnergyTiers && !hasTou) {
      reasonParts.push('missing_energy_pricing');
    }

    const queuedForReview = reasonParts.length > 0;
    let queueId: string | null = null;
    if (queuedForReview) {
      const queueReason = `CURRENT_PLAN_BILL: ${reasonParts.join(', ')}`;
      try {
        const sha = debugBillSha ?? sha256Hex(`text:${String(text ?? '')}`);
        const upserted = await (prisma as any).eflParseReviewQueue.upsert({
          where: { eflPdfSha256: sha },
          create: {
            source: 'current_plan_bill',
            kind: 'EFL_PARSE',
            dedupeKey: `current_plan_bill:${sha}`,
            eflPdfSha256: sha,
            supplier: parsed?.providerName ?? baseline?.providerName ?? null,
            planName: parsed?.planName ?? baseline?.planName ?? null,
            eflUrl: null,
            tdspName: parsed?.tdspName ?? null,
            termMonths: typeof parsed?.termMonths === 'number' ? parsed.termMonths : null,
            rawText: String(text ?? '').slice(0, 250_000),
            planRules: null,
            rateStructure: null,
            validation: null,
            derivedForValidation: {
              uploadId: debugUploadId,
              houseId: debugHouseId,
              usedAi: debugUsedAi,
              baseline,
              parsed,
            },
            finalStatus: 'FAIL',
            queueReason,
            solverApplied: {
              parserVersion: entryData.parserVersion ?? null,
              source: 'api/current-plan/bill-parse',
            },
          },
          update: {
            updatedAt: new Date(),
            source: 'current_plan_bill',
            kind: 'EFL_PARSE',
            dedupeKey: `current_plan_bill:${sha}`,
            supplier: parsed?.providerName ?? baseline?.providerName ?? null,
            planName: parsed?.planName ?? baseline?.planName ?? null,
            tdspName: parsed?.tdspName ?? null,
            termMonths: typeof parsed?.termMonths === 'number' ? parsed.termMonths : null,
            rawText: String(text ?? '').slice(0, 250_000),
            derivedForValidation: {
              uploadId: debugUploadId,
              houseId: debugHouseId,
              usedAi: debugUsedAi,
              baseline,
              parsed,
            },
            finalStatus: 'FAIL',
            queueReason,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
          select: { id: true },
        });
        queueId = upserted?.id ? String(upserted.id) : null;
      } catch (e) {
        console.error('[current-plan/bill-parse] failed to enqueue bill parse review item', e);
      }
    }

    const decimalToNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string') {
        const parsedNum = Number(value);
        return Number.isFinite(parsedNum) ? parsedNum : null;
      }
      if (typeof value === 'object' && value && 'toNumber' in (value as any)) {
        try {
          const result = (value as { toNumber?: () => number }).toNumber?.();
          return typeof result === 'number' && Number.isFinite(result) ? result : null;
        } catch {
          return null;
        }
      }
      const parsedNum = Number(value);
      return Number.isFinite(parsedNum) ? parsedNum : null;
    };

    const serializedParsedPlan = {
      id: record.id as string,
      userId: record.userId as string,
      houseId: record.houseId as string,
      providerName: record.providerName ?? null,
      planName: record.planName ?? null,
      rateType: record.rateType ?? null,
      meterNumber: record.meterNumber ?? null,
      energyRateCents: decimalToNumber(record.energyRateCents),
      baseMonthlyFee: decimalToNumber(record.baseMonthlyFee),
      billCreditDollars: decimalToNumber(record.billCreditDollars),
      termLengthMonths: record.termLengthMonths ?? null,
      contractEndDate: record.contractEndDate
        ? (record.contractEndDate as Date).toISOString()
        : null,
      earlyTerminationFee: decimalToNumber(record.earlyTerminationFee),
      esiId: record.esiId ?? null,
      accountNumberLast4: record.accountNumberLast4 ?? null,
      notes: record.notes ?? null,
      rateStructure: record.rateStructure ?? null,
      parserVersion: record.parserVersion ?? null,
      confidenceScore: typeof record.confidenceScore === 'number' ? record.confidenceScore : null,
      createdAt: (record.createdAt as Date).toISOString(),
      updatedAt: (record.updatedAt as Date).toISOString(),
    };

    return NextResponse.json({
      ok: true,
      parsedPlan: serializedParsedPlan,
      eflVersionCode: parsed.eflVersionCode ?? null,
      warnings: queuedForReview ? reasonParts : [],
      queuedForReview,
      queueId,
    });
  } catch (error) {
    console.error('[current-plan/bill-parse] Failed to parse bill', error);

    // Best-effort: enqueue exception cases too, so admin can iterate on extraction.
    try {
      const sha = debugBillSha ?? (debugRawText ? sha256Hex(`text:${debugRawText}`) : null);
      if (sha && debugRawText) {
        const queueReason = `CURRENT_PLAN_BILL: exception ${error instanceof Error ? error.message : String(error)}`;
        await (prisma as any).eflParseReviewQueue.upsert({
          where: { eflPdfSha256: sha },
          create: {
            source: 'current_plan_bill',
            kind: 'EFL_PARSE',
            dedupeKey: `current_plan_bill:${sha}`,
            eflPdfSha256: sha,
            supplier: (debugParsed as any)?.providerName ?? (debugBaseline as any)?.providerName ?? null,
            planName: (debugParsed as any)?.planName ?? (debugBaseline as any)?.planName ?? null,
            rawText: String(debugRawText).slice(0, 250_000),
            derivedForValidation: {
              uploadId: debugUploadId,
              houseId: debugHouseId,
              usedAi: debugUsedAi,
              baseline: debugBaseline,
              parsed: debugParsed,
              error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
            },
            finalStatus: 'FAIL',
            queueReason,
            solverApplied: { parserVersion: process.env.OPENAI_IntelliWatt_Bill_Parcer ? 'bill-text-v3-json' : 'bill-text-v1-regex' },
          },
          update: {
            updatedAt: new Date(),
            source: 'current_plan_bill',
            kind: 'EFL_PARSE',
            dedupeKey: `current_plan_bill:${sha}`,
            rawText: String(debugRawText).slice(0, 250_000),
            derivedForValidation: {
              uploadId: debugUploadId,
              houseId: debugHouseId,
              usedAi: debugUsedAi,
              baseline: debugBaseline,
              parsed: debugParsed,
              error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
            },
            finalStatus: 'FAIL',
            queueReason,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
        });
      }
    } catch (e) {
      console.error('[current-plan/bill-parse] failed to enqueue exception case', e);
    }

    return NextResponse.json({ error: 'Failed to parse bill' }, { status: 500 });
  }
}

