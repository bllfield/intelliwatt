import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import { normalizeScenarioKey } from "@/modules/usageSimulator/repo";
import { runSimulatorDiagnostic } from "@/lib/admin/simulatorDiagnostic";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

/** Fetch all travel/vacant ranges stored in scenario events for this house (all scenarios). */
async function getTravelRangesFromDb(userId: string, houseId: string): Promise<Array<{ startDate: string; endDate: string }>> {
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({ where: { userId, houseId, archivedAt: null }, select: { id: true } })
    .catch(() => []);
  if (!scenarios?.length) return [];
  const scenarioIds = scenarios.map((s: { id: string }) => s.id);
  const events = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
      select: { payloadJson: true },
    })
    .catch(() => []);
  const seen = new Set<string>();
  const out: Array<{ startDate: string; endDate: string }> = [];
  for (const e of events ?? []) {
    const p = (e as any)?.payloadJson ?? {};
    const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
    const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    const key = `${startDate}\t${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return out;
}

/**
 * GET: Load homes for email and optionally vacant/travel ranges for a house.
 * Query: email (required), houseId (optional). Returns { ok, houses, travelRanges? }.
 */
export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const url = new URL(req.url);
    const email = normalizeEmailSafe(url.searchParams.get("email") ?? "");
    const houseId = typeof url.searchParams.get("houseId") === "string" ? url.searchParams.get("houseId")!.trim() : "";

    if (!email) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "User not found for email." }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      select: { id: true, label: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, isPrimary: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    const houseList = houses.map((h) => ({
      id: h.id,
      label: h.label ?? null,
      addressLine1: h.addressLine1 ?? null,
      city: h.addressCity ?? null,
      state: h.addressState ?? null,
      addressZip5: h.addressZip5 ?? null,
      isPrimary: h.isPrimary ?? false,
    }));

    let travelRanges: Array<{ startDate: string; endDate: string }> | undefined;
    if (houseId) {
      const house = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id, archivedAt: null },
        select: { id: true },
      });
      if (house) {
        travelRanges = await getTravelRangesFromDb(user.id, house.id);
      }
    }

    return NextResponse.json({
      ok: true,
      houses: houseList,
      ...(travelRanges !== undefined ? { travelRanges } : {}),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

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
    const travelRangesOverride = Array.isArray(body?.travelRanges)
      ? (body.travelRanges as Array<{ startDate?: string; endDate?: string }>)
          .map((r) => ({
            startDate: typeof r?.startDate === "string" ? r.startDate.trim().slice(0, 10) : "",
            endDate: typeof r?.endDate === "string" ? r.endDate.trim().slice(0, 10) : "",
          }))
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
      : undefined;

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
      travelRangesOverride: travelRangesOverride && travelRangesOverride.length > 0 ? travelRangesOverride : undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    const diagnostic = result;
    const payload = {
      ok: true as const,
      diagnostic: {
        ok: diagnostic.ok,
        context: diagnostic.context,
        pastPath: diagnostic.pastPath,
        weatherProvenance: diagnostic.weatherProvenance,
        stubAudit: diagnostic.stubAudit,
        parity: diagnostic.parity,
        gapfillLabNote: diagnostic.gapfillLabNote,
      },
    };
    return NextResponse.json(payload);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    const message = err.message;
    const stack = err.stack;
    console.error("[diagnostic] POST failed", { message, stack });
    return NextResponse.json(
      { ok: false, error: message, ...(process.env.NODE_ENV === "development" && stack ? { stack } : {}) },
      { status: 500 }
    );
  }
}
