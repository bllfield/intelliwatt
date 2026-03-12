import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { listOpenSimulationDataAlerts } from "@/modules/usageSimulator/simulationDataAlerts";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = requireAdmin(request);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  try {
    const alerts = await listOpenSimulationDataAlerts(200);
    return NextResponse.json({ ok: true, alerts });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2021" &&
      /SimulationDataAlert/i.test(error.message)
    ) {
      return NextResponse.json({ ok: true, alerts: [] });
    }
    console.error("[admin/sim-alerts] failed", error);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
