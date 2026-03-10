import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import { normalizeScenarioKey } from "@/modules/usageSimulator/repo";
import { runSimulatorDiagnostic } from "@/lib/admin/simulatorDiagnostic";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

/**
 * Admin-only: run full simulator/weather diagnostic for a house.
 * POST body: { email: string, houseId: string, scenarioId?: string, startDate?: string, endDate?: string, recalcFirst?: boolean, includeParity?: boolean }
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmailSafe(body?.email);
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const scenarioId = typeof body?.scenarioId === "string" ? body.scenarioId.trim() || null : null;
    const startDateOverride = typeof body?.startDate === "string" ? body.startDate.trim().slice(0, 10) : undefined;
    const endDateOverride = typeof body?.endDate === "string" ? body.endDate.trim().slice(0, 10) : undefined;
    const recalcFirst = Boolean(body?.recalcFirst);
    const includeParity = Boolean(body?.includeParity);

    if (!email) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!houseId) {
      return NextResponse.json({ ok: false, error: "houseId is required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
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
        select: { buildInputs: true, buildInputsHash: true },
      })
      .catch(() => null);

    if (!buildRec?.buildInputs) {
      return NextResponse.json(
        { ok: false, error: "No build found for this house/scenario. Run inspect or recalc first." },
        { status: 400 }
      );
    }

    if (recalcFirst) {
      const mode = (buildRec.buildInputs as any)?.mode ?? "SMT_BASELINE";
      await recalcSimulatorBuild({
        userId: user.id,
        houseId: house.id,
        esiid: house.esiid ?? null,
        mode: mode as "SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS",
        scenarioId: resolvedScenarioId,
        persistPastSimBaseline: false,
      });
      const freshBuild = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: {
            userId_houseId_scenarioKey: { userId: user.id, houseId: house.id, scenarioKey },
          },
          select: { buildInputs: true, buildInputsHash: true },
        })
        .catch(() => null);
      if (freshBuild?.buildInputs) {
        buildRec.buildInputs = freshBuild.buildInputs;
        buildRec.buildInputsHash = freshBuild.buildInputsHash;
      }
    }

    const result = await runSimulatorDiagnostic({
      userId: user.id,
      houseId: house.id,
      esiid: house.esiid ?? null,
      buildInputs: buildRec.buildInputs,
      scenarioId: resolvedScenarioId,
      scenarioKey,
      buildInputsHash: buildRec.buildInputsHash ?? null,
      startDateOverride: startDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(startDateOverride) ? startDateOverride : undefined,
      endDateOverride: endDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(endDateOverride) ? endDateOverride : undefined,
      includeParity,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, diagnostic: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
