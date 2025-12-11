import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { extractCurrentPlanFromBillTextWithOpenAI } from '@/lib/billing/parseBillText';

export const dynamic = 'force-dynamic';

const decimalFromNumber = (
  value: number,
  precision: number,
  scale: number,
): CurrentPlanPrisma.Decimal => {
  const multiplier = 10 ** scale;
  const rounded = Math.round(value * multiplier) / multiplier;
  return new CurrentPlanPrisma.Decimal(rounded.toFixed(scale));
};

export async function POST(request: NextRequest) {
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

    if (!houseId) {
      return NextResponse.json({ error: 'houseId is required' }, { status: 400 });
    }

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

    const currentPlanPrisma = getCurrentPlanPrisma();

    let uploadRecord: { id: string; filename: string; mimeType: string; billData: Buffer } | null =
      null;

    if (!textOverride) {
      const billDelegate = currentPlanPrisma.currentPlanBillUpload as any;

      if (uploadIdRaw && typeof uploadIdRaw === 'string' && uploadIdRaw.trim().length > 0) {
        uploadRecord = await billDelegate.findFirst({
          where: { id: uploadIdRaw.trim(), userId: user.id, houseId },
          select: { id: true, filename: true, mimeType: true, billData: true },
        });
      }

      if (!uploadRecord) {
        uploadRecord = await billDelegate.findFirst({
          where: { userId: user.id, houseId },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, filename: true, mimeType: true, billData: true },
        });
      }

      if (!uploadRecord) {
        return NextResponse.json(
          { error: 'No uploaded bill found for this house. Upload a bill first.' },
          { status: 404 },
        );
      }
    }

    const text =
      textOverride ?? uploadRecord!.billData.toString('utf8').slice(0, 20000);

    const parsed = await extractCurrentPlanFromBillTextWithOpenAI(text, {});

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
      parserVersion: 'bill-text-v1-regex',
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
      warnings: [],
    });
  } catch (error) {
    console.error('[current-plan/bill-parse] Failed to parse bill', error);
    return NextResponse.json({ error: 'Failed to parse bill' }, { status: 500 });
  }
}


