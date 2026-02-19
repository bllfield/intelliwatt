import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { usagePrisma } from "@/lib/db/usageClient";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatorRequirements } from "@/modules/usageSimulator/service";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DbStatus = "ok" | "missing_env" | "unreachable" | "error";

function getPrismaInitCode(e: any): string | null {
  const c = (e as any)?.code ?? (e as any)?.errorCode ?? null;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

function classifyDbError(e: any, envVarName: string): DbStatus {
  const msg = typeof e?.message === "string" ? e.message : String(e ?? "");
  const code = getPrismaInitCode(e); // Prisma init error codes like P1001/P1000/P1003
  if (new RegExp(envVarName, "i").test(msg)) return "missing_env";
  if (code === "P1001" || /P1001/i.test(msg)) return "unreachable";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg)) return "unreachable";
  if (/Can't reach database server/i.test(msg)) return "unreachable";
  return "error";
}

function classifyDbDetail(e: any) {
  const code = getPrismaInitCode(e);
  const name = typeof e?.name === "string" ? e.name : null;
  return { code, name };
}

async function probeHomeDetails(): Promise<{ status: DbStatus; detail: { code: string | null; name: string | null } | null }> {
  if (!String(process.env.HOME_DETAILS_DATABASE_URL ?? "").trim()) return { status: "missing_env", detail: null };
  try {
    // Avoid model coupling: this probe should work even if module schemas change.
    await homeDetailsPrisma.$queryRaw`SELECT 1`;
    return { status: "ok", detail: null };
  } catch (e: any) {
    return { status: classifyDbError(e, "HOME_DETAILS_DATABASE_URL"), detail: classifyDbDetail(e) };
  }
}

async function probeAppliances(): Promise<{ status: DbStatus; detail: { code: string | null; name: string | null } | null }> {
  if (!String(process.env.APPLIANCES_DATABASE_URL ?? "").trim()) return { status: "missing_env", detail: null };
  try {
    // Avoid model coupling: this probe should work even if module schemas change.
    await appliancesPrisma.$queryRaw`SELECT 1`;
    return { status: "ok", detail: null };
  } catch (e: any) {
    return { status: classifyDbError(e, "APPLIANCES_DATABASE_URL"), detail: classifyDbDetail(e) };
  }
}

async function probeUsage(): Promise<{ status: DbStatus; detail: { code: string | null; name: string | null } | null }> {
  if (!String(process.env.USAGE_DATABASE_URL ?? "").trim()) return { status: "missing_env", detail: null };
  try {
    // Avoid model coupling: this probe should work even if module schemas change.
    await usagePrisma.$queryRaw`SELECT 1`;
    return { status: "ok", detail: null };
  } catch (e: any) {
    return { status: classifyDbError(e, "USAGE_DATABASE_URL"), detail: classifyDbDetail(e) };
  }
}

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    const mode = String(searchParams.get("mode") ?? "").trim() as SimulatorMode;
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (mode !== "MANUAL_TOTALS" && mode !== "NEW_BUILD_ESTIMATE" && mode !== "SMT_BASELINE") {
      return NextResponse.json({ ok: false, error: "mode_invalid" }, { status: 400 });
    }

    const [out, homeDetailsProbe, appliancesProbe, usageProbe] = await Promise.all([
      getSimulatorRequirements({ userId: u.user.id, houseId, mode }),
      probeHomeDetails(),
      probeAppliances(),
      probeUsage(),
    ]);
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json({
      ...out,
      dbStatus: {
        homeDetails: homeDetailsProbe.status,
        appliances: appliancesProbe.status,
        usage: usageProbe.status,
      },
      // Additive, sanitized debug metadata to help diagnose prod wiring issues quickly.
      dbStatusDetail: {
        homeDetails: homeDetailsProbe.detail,
        appliances: appliancesProbe.detail,
        usage: usageProbe.detail,
      },
    });
  } catch (e) {
    console.error("[user/simulator/requirements] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

