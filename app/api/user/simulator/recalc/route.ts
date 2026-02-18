import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmail } from "@/lib/utils/email";
import { canonicalWindow12Months } from "@/modules/usageSimulator/canonicalWindow";
import { hasSmtIntervals } from "@/modules/usageSimulator/smt";
import { buildSimulatorInputs } from "@/modules/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/usageSimulator/requirements";
import { buildSimulatedUsageDatasetFromBuildInputs, type SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

async function requireHouse(userId: string, houseId: string) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  return h ?? null;
}

function stableHashJson(obj: any): string {
  const s = JSON.stringify(obj);
  return createHash("sha256").update(s).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const mode = typeof body?.mode === "string" ? (body.mode.trim() as SimulatorMode) : null;
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (mode !== "MANUAL_TOTALS" && mode !== "NEW_BUILD_ESTIMATE" && mode !== "SMT_BASELINE") {
      return NextResponse.json({ ok: false, error: "mode_invalid" }, { status: 400 });
    }

    const house = await requireHouse(u.user.id, houseId);
    if (!house) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });

    const canonical = canonicalWindow12Months(new Date());

    const [manualRec, homeRec, applianceRec] = await Promise.all([
      (prisma as any).manualUsageInput
        .findUnique({ where: { userId_houseId: { userId: u.user.id, houseId } }, select: { payload: true } })
        .catch(() => null),
      (homeDetailsPrisma as any).homeProfileSimulated
        .findUnique({ where: { userId_houseId: { userId: u.user.id, houseId } } })
        .catch(() => null),
      (appliancesPrisma as any).applianceProfileSimulated
        .findUnique({ where: { userId_houseId: { userId: u.user.id, houseId } }, select: { appliancesJson: true } })
        .catch(() => null),
    ]);

    const manualUsagePayload = (manualRec?.payload as any) ?? null;
    const homeProfile = homeRec
      ? {
          homeAge: homeRec.homeAge,
          homeStyle: homeRec.homeStyle,
          squareFeet: homeRec.squareFeet,
          stories: homeRec.stories,
          insulationType: homeRec.insulationType,
          windowType: homeRec.windowType,
          foundation: homeRec.foundation,
          ledLights: homeRec.ledLights,
          smartThermostat: homeRec.smartThermostat,
          summerTemp: homeRec.summerTemp,
          winterTemp: homeRec.winterTemp,
          occupantsWork: homeRec.occupantsWork,
          occupantsSchool: homeRec.occupantsSchool,
          occupantsHomeAllDay: homeRec.occupantsHomeAllDay,
          fuelConfiguration: homeRec.fuelConfiguration,
        }
      : null;

    const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);

    const smtOk = house.esiid ? await hasSmtIntervals({ esiid: house.esiid, canonicalMonths: canonical.months }) : false;

    const req = computeRequirements(
      {
        manualUsagePayload: manualUsagePayload as any,
        homeProfile: homeProfile as any,
        applianceProfile: applianceProfile as any,
        hasSmtIntervals: smtOk,
      },
      mode,
    );
    if (!req.canRecalc) {
      return NextResponse.json({ ok: false, error: "requirements_unmet", missingItems: req.missingItems }, { status: 400 });
    }

    if (!homeProfile) return NextResponse.json({ ok: false, error: "homeProfile_required" }, { status: 400 });
    if (!applianceProfile?.fuelConfiguration) return NextResponse.json({ ok: false, error: "applianceProfile_required" }, { status: 400 });

    const existingBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({ where: { userId_houseId: { userId: u.user.id, houseId } }, select: { buildInputs: true, baseKind: true } })
      .catch(() => null);

    const existingInputs = (existingBuild?.buildInputs as any) ?? null;
    const baselineHomeProfile =
      mode === "SMT_BASELINE" && existingBuild?.baseKind === "SMT_ACTUAL_BASELINE" ? existingInputs?.snapshots?.baselineHomeProfile ?? null : null;
    const baselineApplianceProfile =
      mode === "SMT_BASELINE" && existingBuild?.baseKind === "SMT_ACTUAL_BASELINE" ? existingInputs?.snapshots?.baselineApplianceProfile ?? null : null;

    const built = await buildSimulatorInputs({
      mode,
      manualUsagePayload: manualUsagePayload as any,
      homeProfile,
      applianceProfile,
      esiidForSmt: house.esiid ?? null,
      baselineHomeProfile: baselineHomeProfile ?? homeProfile,
      baselineApplianceProfile: baselineApplianceProfile ?? applianceProfile,
    });

    const buildInputs: SimulatorBuildInputsV1 = {
      version: 1,
      mode,
      baseKind: built.baseKind === "SMT_ACTUAL_BASELINE" ? "SMT_ACTUAL_BASELINE" : built.baseKind,
      canonicalEndMonth: canonical.endMonth,
      canonicalMonths: built.canonicalMonths,
      monthlyTotalsKwhByMonth: built.monthlyTotalsKwhByMonth,
      intradayShape96: built.intradayShape96,
      weekdayWeekendShape96: built.weekdayWeekendShape96,
      travelRanges: mode === "MANUAL_TOTALS" ? (manualUsagePayload?.travelRanges ?? []) : [],
      notes: built.notes,
      filledMonths: built.filledMonths,
      snapshots: {
        manualUsagePayload: manualUsagePayload ?? null,
        homeProfile,
        applianceProfile,
        baselineHomeProfile: (baselineHomeProfile ?? homeProfile) ?? null,
        baselineApplianceProfile: (baselineApplianceProfile ?? applianceProfile) ?? null,
        smtMonthlyAnchorsByMonth: built.source?.smtMonthlyAnchorsByMonth ?? undefined,
        smtIntradayShape96: built.source?.smtIntradayShape96 ?? undefined,
      },
    };

    const buildInputsHash = stableHashJson(buildInputs);
    const dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);

    await (prisma as any).usageSimulatorBuild.upsert({
      where: { userId_houseId: { userId: u.user.id, houseId } },
      create: {
        userId: u.user.id,
        houseId,
        mode,
        baseKind: buildInputs.baseKind,
        canonicalEndMonth: buildInputs.canonicalEndMonth,
        canonicalMonths: buildInputs.canonicalMonths,
        buildInputs,
        buildInputsHash,
        lastBuiltAt: new Date(),
      },
      update: {
        mode,
        baseKind: buildInputs.baseKind,
        canonicalEndMonth: buildInputs.canonicalEndMonth,
        canonicalMonths: buildInputs.canonicalMonths,
        buildInputs,
        buildInputsHash,
        lastBuiltAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, houseId, buildInputsHash, dataset });
  } catch (e) {
    console.error("[user/simulator/recalc] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

