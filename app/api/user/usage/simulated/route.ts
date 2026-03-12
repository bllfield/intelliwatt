import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatedUsageForUser } from "@/modules/usageSimulator/service";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Allow time for per-house baseline build (actual or simulated) when loading the list. */
export const maxDuration = 120;

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value;
    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const out = await getSimulatedUsageForUser({ userId: user.id });
    if (!out.ok) {
      const classification = classifySimulationFailure({
        code: "INTERNAL_ERROR",
        message: out.error,
      });
      if (classification.shouldAlert) {
        await recordSimulationDataAlert({
          source: "USER_SIMULATION",
          userId: user.id,
          userEmail,
          reasonCode: classification.reasonCode,
          reasonMessage: classification.reasonMessage,
          missingData: classification.missingData,
          context: { route: "/api/user/usage/simulated", serviceError: out.error },
        });
      }
      return NextResponse.json(
        {
          ok: false,
          error: out.error,
          code: classification.reasonCode,
          explanation: classification.userFacingExplanation,
          missingData: classification.missingData,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    console.error("[user/usage/simulated] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal error",
        explanation: "Simulated usage is temporarily unavailable due to a backend failure.",
      },
      { status: 500 }
    );
  }
}

