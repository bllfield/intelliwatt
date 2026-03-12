import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { computePastInputHash, deleteCachedPastDataset, PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import { normalizeScenarioKey } from "@/modules/usageSimulator/repo";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function getWindowFromBuildInputs(buildInputs: Record<string, unknown>): { startDate: string; endDate: string } | null {
  const periods = Array.isArray(buildInputs?.canonicalPeriods) ? buildInputs.canonicalPeriods : [];
  const first = periods.length > 0 ? String(periods[0]?.startDate ?? "").slice(0, 10) : "";
  const last = periods.length > 0 ? String(periods[periods.length - 1]?.endDate ?? "").slice(0, 10) : "";
  if (YYYY_MM_DD.test(first) && YYYY_MM_DD.test(last)) return { startDate: first, endDate: last };

  const months = Array.isArray(buildInputs?.canonicalMonths) ? buildInputs.canonicalMonths : [];
  const firstMonth = String(months[0] ?? "");
  const lastMonth = String(months[months.length - 1] ?? "");
  if (!/^\d{4}-\d{2}$/.test(firstMonth) || !/^\d{4}-\d{2}$/.test(lastMonth)) return null;
  const [y, m] = lastMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${firstMonth}-01`, endDate: `${lastMonth}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * POST: Delete cached Past dataset for house/scenario so next request cold-builds and re-caches.
 * Body: { email: string, houseId: string, scenarioId?: string }
 * Returns: { ok: true, deleted: number } or { ok: false, error: string }
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmailSafe(body?.email);
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const scenarioId = typeof body?.scenarioId === "string" ? body.scenarioId.trim() || null : null;

    if (!email) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!houseId) {
      return NextResponse.json({ ok: false, error: "houseId is required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "User not found for email." }, { status: 404 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseId, userId: user.id, archivedAt: null },
      select: { id: true, esiid: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "House not found or does not belong to user." }, { status: 404 });
    }

    let resolvedScenarioId: string | null = scenarioId;
    if (!resolvedScenarioId) {
      const pastScenario = await (prisma as any).usageSimulatorScenario
        .findFirst({
          where: { userId: user.id, houseId: house.id, name: WORKSPACE_PAST_NAME, archivedAt: null },
          select: { id: true },
        })
        .catch(() => null);
      resolvedScenarioId = pastScenario?.id ?? null;
    } else {
      const scenario = await (prisma as any).usageSimulatorScenario
        .findFirst({
          where: { id: resolvedScenarioId, userId: user.id, houseId: house.id, archivedAt: null },
          select: { id: true },
        })
        .catch(() => null);
      if (!scenario) {
        return NextResponse.json({ ok: false, error: "Scenario not found or does not belong to this house/user." }, { status: 400 });
      }
    }

    const scenarioKey = normalizeScenarioKey(resolvedScenarioId);
    const buildRec = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: {
          userId_houseId_scenarioKey: { userId: user.id, houseId: house.id, scenarioKey },
        },
        select: { buildInputs: true },
      })
      .catch(() => null);

    if (!buildRec?.buildInputs) {
      return NextResponse.json(
        { ok: false, error: "No build found for this house/scenario. Run inspect or recalc first." },
        { status: 400 }
      );
    }

    const buildInputs = buildRec.buildInputs as Record<string, unknown>;
    const window = getWindowFromBuildInputs(buildInputs);
    if (!window) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve window from buildInputs (canonicalMonths or canonicalPeriods)." },
        { status: 400 }
      );
    }

    const travelRanges = (Array.isArray(buildInputs?.travelRanges) ? buildInputs.travelRanges : []) as Array<{ startDate: string; endDate: string }>;
    const timezone = (buildInputs?.timezone as string) ?? "America/Chicago";
    const intervalDataFingerprint = await getIntervalDataFingerprint({
      houseId: house.id,
      esiid: house.esiid ?? null,
      startDate: window.startDate,
      endDate: window.endDate,
    });
    const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(house.id);
    const inputHash = computePastInputHash({
      engineVersion: PAST_ENGINE_VERSION,
      windowStartUtc: window.startDate,
      windowEndUtc: window.endDate,
      timezone,
      travelRanges,
      buildInputs,
      intervalDataFingerprint,
      usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
      usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
      usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    });

    const scenarioIdForCache = resolvedScenarioId ?? "BASELINE";
    const deleted = await deleteCachedPastDataset({
      houseId: house.id,
      scenarioId: scenarioIdForCache,
      inputHash,
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
