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

function classifyDbError(e: any, envVarName: string): DbStatus {
  const msg = typeof e?.message === "string" ? e.message : String(e ?? "");
  const code = typeof e?.code === "string" ? e.code : null; // Prisma error codes like P1001
  if (new RegExp(envVarName, "i").test(msg)) return "missing_env";
  if (code === "P1001" || /P1001/i.test(msg)) return "unreachable";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg)) return "unreachable";
  return "error";
}

async function probeHomeDetails(): Promise<DbStatus> {
  if (!String(process.env.HOME_DETAILS_DATABASE_URL ?? "").trim()) return "missing_env";
  try {
    await (homeDetailsPrisma as any).homeDetailsModuleBootstrap.findFirst({ select: { id: true } });
    return "ok";
  } catch (e: any) {
    return classifyDbError(e, "HOME_DETAILS_DATABASE_URL");
  }
}

async function probeAppliances(): Promise<DbStatus> {
  if (!String(process.env.APPLIANCES_DATABASE_URL ?? "").trim()) return "missing_env";
  try {
    await (appliancesPrisma as any).appliancesModuleBootstrap.findFirst({ select: { id: true } });
    return "ok";
  } catch (e: any) {
    return classifyDbError(e, "APPLIANCES_DATABASE_URL");
  }
}

async function probeUsage(): Promise<DbStatus> {
  if (!String(process.env.USAGE_DATABASE_URL ?? "").trim()) return "missing_env";
  try {
    await (usagePrisma as any).usageModuleBootstrap.findFirst({ select: { id: true } });
    return "ok";
  } catch (e: any) {
    return classifyDbError(e, "USAGE_DATABASE_URL");
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

    const [out, homeDetails, appliances, usage] = await Promise.all([
      getSimulatorRequirements({ userId: u.user.id, houseId, mode }),
      probeHomeDetails(),
      probeAppliances(),
      probeUsage(),
    ]);
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json({
      ...out,
      dbStatus: {
        homeDetails,
        appliances,
        usage,
      },
    });
  } catch (e) {
    console.error("[user/simulator/requirements] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

