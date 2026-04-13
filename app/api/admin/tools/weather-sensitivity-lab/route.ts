import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return email != null && ADMIN_EMAILS.includes(email);
}

export async function GET(request: NextRequest) {
  if (!hasAdminSessionCookie(request)) {
    const gate = requireAdmin(request);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }

  const url = new URL(request.url);
  const email = normalizeEmailSafe(url.searchParams.get("email") ?? "");
  const requestedHouseId = String(url.searchParams.get("houseId") ?? "").trim();
  if (!email) {
    return NextResponse.json({ ok: true, user: null, houses: [], selectedHouseId: null });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  const houses = await prisma.houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    select: {
      id: true,
      label: true,
      addressLine1: true,
      addressCity: true,
      addressState: true,
      esiid: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const scoredHouses = [];
  for (const house of houses) {
    const [actualResult, manualUsage, homeProfile, applianceProfileRec] = await Promise.all([
      getActualUsageDatasetForHouse(house.id, house.esiid ?? null, { skipFullYearIntervalFetch: true }).catch(() => null),
      getManualUsageInputForUserHouse({ userId: user.id, houseId: house.id }).catch(() => ({ payload: null })),
      getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }).catch(() => null),
      getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }).catch(() => null),
    ]);
    const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
    const weatherSensitivity = await resolveSharedWeatherSensitivityEnvelope({
      actualDataset: actualResult?.dataset ?? null,
      manualUsagePayload: manualUsage?.payload ?? null,
      homeProfile,
      applianceProfile,
      weatherHouseId: house.id,
    }).catch(() => ({ score: null, derivedInput: null }));

    scoredHouses.push({
      houseId: house.id,
      label: toPublicHouseLabel({
        label: house.label,
        addressLine1: house.addressLine1,
        fallbackId: house.id,
      }),
      address: {
        line1: house.addressLine1,
        city: house.addressCity,
        state: house.addressState,
      },
      scoringMode: weatherSensitivity.score?.scoringMode ?? null,
      score: weatherSensitivity.score,
      derivedInput: weatherSensitivity.derivedInput,
    });
  }

  const selectedHouseId =
    scoredHouses.find((house) => house.houseId === requestedHouseId)?.houseId ??
    scoredHouses.find((house) => house.score != null)?.houseId ??
    scoredHouses[0]?.houseId ??
    null;

  return NextResponse.json({
    ok: true,
    user,
    houses: scoredHouses,
    selectedHouseId,
  });
}
