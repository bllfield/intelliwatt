import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { normalizeEmail } from "@/lib/utils/email";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  const emailsRaw: unknown[] = Array.isArray(body?.emails) ? (body.emails as unknown[]) : [];
  const houseIdsRaw: unknown[] = Array.isArray(body?.houseIds) ? (body.houseIds as unknown[]) : [];
  const dryRun = body?.dryRun !== false; // default true
  const confirm = String(body?.confirm ?? "").trim();

  if (!dryRun && confirm !== "DELETE") {
    return jsonError(400, 'Missing confirmation. Set {"confirm":"DELETE","dryRun":false} to apply.');
  }

  const emails: string[] = uniq(
    emailsRaw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .map((e) => normalizeEmail(e)),
  ) as string[];
  const houseIds: string[] = uniq(
    houseIdsRaw.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean),
  ) as string[];

  if (emails.length === 0 && houseIds.length === 0) {
    return jsonError(400, "Provide at least one email or houseId.");
  }

  // Resolve users from emails
  const users = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : [];
  const userIds = uniq(users.map((u) => u.id));

  // Resolve houses from explicit IDs + userIds
  const houses = await prisma.houseAddress.findMany({
    where: {
      OR: [
        ...(houseIds.length ? [{ id: { in: houseIds } }] : []),
        ...(userIds.length ? [{ userId: { in: userIds } }] : []),
      ],
    },
    select: { id: true, userId: true, userEmail: true, esiid: true },
  });
  const targetHouseIds = uniq(houses.map((h) => h.id));
  const targetUserIds = uniq([...userIds, ...houses.map((h) => h.userId)].filter(Boolean));
  const esiids = uniq(
    houses
      .map((h) => String(h.esiid ?? "").trim())
      .filter(Boolean),
  );

  const planEstimateWhere = targetHouseIds.length ? { houseAddressId: { in: targetHouseIds } } : undefined;

  const counts = async () => {
    const out: Record<string, number> = {};
    if (targetUserIds.length) {
      out.User = await prisma.user.count({ where: { id: { in: targetUserIds } } });
      out.Session = await prisma.session.count({ where: { userId: { in: targetUserIds } } });
      out.Entry = await prisma.entry.count({ where: { userId: { in: targetUserIds } } });
      out.EntryExpiryDigest = await prisma.entryExpiryDigest.count({ where: { userId: { in: targetUserIds } } });
      out.UserProfile = await prisma.userProfile.count({ where: { userId: { in: targetUserIds } } });
      out.UsageData = await prisma.usageData.count({ where: { userId: { in: targetUserIds } } });
      out.UtilityPlan = await prisma.utilityPlan.count({ where: { userId: { in: targetUserIds } } });
      out.Referral = await prisma.referral.count({ where: { referredById: { in: targetUserIds } } });
      out.CommissionRecord = await prisma.commissionRecord.count({ where: { userId: { in: targetUserIds } } });
      out.JackpotPayout = await prisma.jackpotPayout.count({ where: { userId: { in: targetUserIds } } });
      out.SmtAuthorization = await prisma.smtAuthorization.count({ where: { userId: { in: targetUserIds } } });
      out.NormalizedCurrentPlan = await (prisma as any).normalizedCurrentPlan.count({
        where: { userId: { in: targetUserIds }, sourceModule: "current-plan" },
      });
    }
    if (targetHouseIds.length) {
      out.HouseAddress = await prisma.houseAddress.count({ where: { id: { in: targetHouseIds } } });
      out.SmtMeterInfo = await prisma.smtMeterInfo.count({ where: { houseId: { in: targetHouseIds } } });
      out.PlanEstimateMaterialized = await prisma.planEstimateMaterialized.count({ where: planEstimateWhere as any });
      out.NormalizedCurrentPlan_byHome = await (prisma as any).normalizedCurrentPlan.count({
        where: { homeId: { in: targetHouseIds }, sourceModule: "current-plan" },
      });
    }
    if (esiids.length) {
      out.SmtInterval = await prisma.smtInterval.count({ where: { esiid: { in: esiids } } });
      out.SmtBillingRead = await prisma.smtBillingRead.count({ where: { esiid: { in: esiids } } });
    }
    return out;
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      inputs: { emails, houseIds },
      resolved: { users, targetUserIds, targetHouseIds, esiids },
      counts: await counts(),
      applyHint: 'Re-run with {"dryRun":false,"confirm":"DELETE"} to apply.',
    });
  }

  const deleted: Record<string, number> = {};

  // Current-plan module deletes (user-scoped)
  if (process.env.CURRENT_PLAN_DATABASE_URL && targetUserIds.length) {
    const cp = getCurrentPlanPrisma() as any;
    // Delete parsed plans + uploads + manual entries for these users/houses.
    const whereCp = {
      userId: { in: targetUserIds },
      ...(targetHouseIds.length ? { houseId: { in: targetHouseIds } } : {}),
    };

    const parsedDel = await cp.parsedCurrentPlan.deleteMany({ where: whereCp });
    deleted.currentPlan_ParsedCurrentPlan = Number(parsedDel?.count ?? 0);

    const manualDel = await cp.currentPlanManualEntry.deleteMany({ where: whereCp });
    deleted.currentPlan_CurrentPlanManualEntry = Number(manualDel?.count ?? 0);

    // Uploads may be tied to user and optional houseId. Delete last (after ParsedCurrentPlan).
    const uploadDel = await cp.currentPlanBillUpload.deleteMany({
      where: {
        userId: { in: targetUserIds },
        ...(targetHouseIds.length ? { houseId: { in: targetHouseIds } } : {}),
      },
    });
    deleted.currentPlan_CurrentPlanBillUpload = Number(uploadDel?.count ?? 0);
  }

  // Master DB deletes (house/user scoped)
  // Delete dependent rows first.
  if (esiids.length) {
    const r1 = await prisma.smtInterval.deleteMany({ where: { esiid: { in: esiids } } });
    deleted.SmtInterval = Number(r1?.count ?? 0);
    const r2 = await prisma.smtBillingRead.deleteMany({ where: { esiid: { in: esiids } } });
    deleted.SmtBillingRead = Number(r2?.count ?? 0);
  }

  if (targetHouseIds.length) {
    const r = await prisma.smtMeterInfo.deleteMany({ where: { houseId: { in: targetHouseIds } } });
    deleted.SmtMeterInfo = Number(r?.count ?? 0);
    const r3 = await prisma.planEstimateMaterialized.deleteMany({ where: planEstimateWhere as any });
    deleted.PlanEstimateMaterialized = Number(r3?.count ?? 0);
    const r4 = await (prisma as any).normalizedCurrentPlan.deleteMany({
      where: { homeId: { in: targetHouseIds }, sourceModule: "current-plan" },
    });
    deleted.NormalizedCurrentPlan_byHome = Number(r4?.count ?? 0);
  }

  if (targetUserIds.length) {
    deleted.EntryExpiryDigest = Number((await prisma.entryExpiryDigest.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.Session = Number((await prisma.session.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.Entry = Number((await prisma.entry.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.UsageData = Number((await prisma.usageData.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.UtilityPlan = Number((await prisma.utilityPlan.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.CommissionRecord = Number((await prisma.commissionRecord.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.JackpotPayout = Number((await prisma.jackpotPayout.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.SmtAuthorization = Number((await prisma.smtAuthorization.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.Referral = Number((await prisma.referral.deleteMany({ where: { referredById: { in: targetUserIds } } }))?.count ?? 0);
    deleted.UserProfile = Number((await prisma.userProfile.deleteMany({ where: { userId: { in: targetUserIds } } }))?.count ?? 0);
    deleted.NormalizedCurrentPlan = Number((await (prisma as any).normalizedCurrentPlan.deleteMany({
      where: { userId: { in: targetUserIds }, sourceModule: "current-plan" },
    }))?.count ?? 0);
  }

  // Houses + users last.
  if (targetHouseIds.length) {
    deleted.HouseAddress = Number((await prisma.houseAddress.deleteMany({ where: { id: { in: targetHouseIds } } }))?.count ?? 0);
  }
  if (targetUserIds.length) {
    deleted.User = Number((await prisma.user.deleteMany({ where: { id: { in: targetUserIds } } }))?.count ?? 0);
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    inputs: { emails, houseIds },
    resolved: { users, targetUserIds, targetHouseIds, esiids },
    deleted,
  });
}

