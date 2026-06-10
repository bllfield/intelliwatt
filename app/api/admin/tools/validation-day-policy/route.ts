import { NextRequest, NextResponse } from "next/server";
import { lookupAdminHousesByEmail, resolveAdminHouseSelection } from "@/lib/admin/adminHouseLookup";
import { normalizeEmailSafe } from "@/lib/utils/email";
import {
  VALIDATION_DAY_POLICY_SAVE_CONFIRMATION,
  clearStoredValidationDayPolicy,
  getValidationDayPolicySnapshotLive,
  previewGlobalValidationDaySelection,
  saveStoredValidationDayPolicy,
} from "@/lib/usage/validationDayPolicy";
import { normalizeValidationSelectionMode } from "@/modules/usageSimulator/validationSelection";
import { gateManualGapfillAdmin } from "@/app/api/admin/tools/manual-gapfill/_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeWindow(body: Record<string, unknown>) {
  const window = body.window;
  if (!window || typeof window !== "object" || Array.isArray(window)) return null;
  const startDate = String((window as Record<string, unknown>).startDate ?? "").slice(0, 10);
  const endDate = String((window as Record<string, unknown>).endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  return { startDate, endDate };
}

function adminActorEmail(request: NextRequest): string | null {
  const cookieEmail = normalizeEmailSafe(request.cookies.get("intelliwatt_admin")?.value ?? "");
  if (cookieEmail) return cookieEmail;
  const headerEmail = normalizeEmailSafe(request.headers.get("x-admin-email") ?? "");
  return headerEmail || null;
}

async function resolvePreviewIdentity(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim();
  if (email) {
    const lookup = await lookupAdminHousesByEmail(email);
    if (!lookup.ok) {
      return { ok: false as const, error: lookup.error, status: lookup.error === "email_required" ? 400 : 404 };
    }
    const requestedHouseId =
      typeof body.houseId === "string" && body.houseId.trim() ? body.houseId.trim() : null;
    const selectedHouse =
      requestedHouseId != null
        ? lookup.houses.find((house) => house.id === requestedHouseId) ??
          (await resolveAdminHouseSelection({ houseId: requestedHouseId }))
        : lookup.houses.find((house) => house.isPrimary) ?? lookup.houses[0] ?? null;
    if (!selectedHouse) {
      return { ok: false as const, error: "house_not_found", status: 400 };
    }
    return {
      ok: true as const,
      email: lookup.email,
      userId: lookup.userId,
      houseId: selectedHouse.id,
      esiid: selectedHouse.esiid,
    };
  }

  const houseId = String(body.houseId ?? body.sourceHouseId ?? "").trim();
  const userId = String(body.userId ?? "").trim();
  if (!houseId || !userId) {
    return {
      ok: false as const,
      error: "email_required",
      message: "User email is required for preview. Admin tools resolve homes by email, not raw houseId/userId.",
      status: 400,
    };
  }
  return { ok: true as const, email: null, userId, houseId, esiid: typeof body.esiid === "string" ? body.esiid : null };
}

export async function GET(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  const surfaceParam = request.nextUrl.searchParams.get("surface");
  const surface = surfaceParam === "user_site" ? "user_site" : "admin_lab";
  return NextResponse.json(await getValidationDayPolicySnapshotLive({ surface }));
}

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "preview").trim().toLowerCase();

    if (action === "save") {
      const confirmation = String(body.confirmation ?? "").trim();
      if (confirmation !== VALIDATION_DAY_POLICY_SAVE_CONFIRMATION) {
        return NextResponse.json(
          {
            ok: false,
            error: "confirmation_required",
            message: `Type ${VALIDATION_DAY_POLICY_SAVE_CONFIRMATION} to save the global compare-day policy.`,
          },
          { status: 400 }
        );
      }
      const selectionMode = normalizeValidationSelectionMode(body.selectionMode);
      if (!selectionMode || selectionMode === "manual") {
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_selection_mode",
            message: "Global policy must use an auto selection mode (not manual).",
          },
          { status: 400 }
        );
      }
      const validationDayCount = Math.floor(Number(body.validationDayCount));
      if (!Number.isFinite(validationDayCount) || validationDayCount < 1) {
        return NextResponse.json(
          { ok: false, error: "invalid_validation_day_count", message: "validationDayCount must be >= 1." },
          { status: 400 }
        );
      }
      const surface = body.surface === "user_site" ? "user_site" : "admin_lab";
      const stored = await saveStoredValidationDayPolicy({
        selectionMode,
        validationDayCount,
        surface,
        updatedBy: adminActorEmail(request),
      });
      const snapshot = await getValidationDayPolicySnapshotLive({ surface });
      return NextResponse.json({ ok: true, stored, snapshot });
    }

    if (action === "reset") {
      const confirmation = String(body.confirmation ?? "").trim();
      if (confirmation !== VALIDATION_DAY_POLICY_SAVE_CONFIRMATION) {
        return NextResponse.json(
          {
            ok: false,
            error: "confirmation_required",
            message: `Type ${VALIDATION_DAY_POLICY_SAVE_CONFIRMATION} to reset the global compare-day policy.`,
          },
          { status: 400 }
        );
      }
      await clearStoredValidationDayPolicy();
      const surface = body.surface === "user_site" ? "user_site" : "admin_lab";
      return NextResponse.json({ ok: true, snapshot: await getValidationDayPolicySnapshotLive({ surface }) });
    }

    const identity = await resolvePreviewIdentity(body);
    if (!identity.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: identity.error,
          message:
            identity.message ??
            (identity.error === "user_not_found"
              ? "No user found for that email."
              : "Could not resolve a house for preview."),
        },
        { status: identity.status }
      );
    }

    const window = normalizeWindow(body);
    const surface = body.surface === "user_site" ? "user_site" : "admin_lab";
    const preview = await previewGlobalValidationDaySelection({
      houseId: identity.houseId,
      userId: identity.userId,
      esiid: identity.esiid,
      sourceHouseId: identity.houseId,
      window,
      validationDayCount:
        body.validationDayCount == null ? null : Math.floor(Number(body.validationDayCount)),
      mode: typeof body.mode === "string" ? body.mode : null,
      surface,
    });

    return NextResponse.json({
      ...preview,
      previewContext: {
        email: identity.email,
        userId: identity.userId,
        houseId: identity.houseId,
        esiid: identity.esiid,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_day_policy_request_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
