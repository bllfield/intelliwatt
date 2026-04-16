import { NextRequest, NextResponse } from "next/server";
import { gateOnePathSimAdmin } from "../_helpers";
import {
  ONE_PATH_DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG,
  ONE_PATH_SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
  ONE_PATH_SIMULATION_VARIABLE_POLICY_FAMILY_META,
  getOnePathSimulationVariableOverrides,
  getOnePathSimulationVariablePolicy,
  resetOnePathSimulationVariableOverrides,
  saveOnePathSimulationVariableOverrides,
  type SimulationVariablePolicy,
  type SimulationVariablePolicyOverrides,
} from "@/modules/onePathSim/runtime";

type FamilyKey = keyof SimulationVariablePolicy;

function isFamilyKey(value: unknown): value is FamilyKey {
  return typeof value === "string" && value in ONE_PATH_DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG;
}

function isModeBucketKey(value: unknown): value is "sharedDefaults" | "intervalOverrides" | "manualMonthlyOverrides" | "manualAnnualOverrides" | "newBuildOverrides" {
  return (
    value === "sharedDefaults" ||
    value === "intervalOverrides" ||
    value === "manualMonthlyOverrides" ||
    value === "manualAnnualOverrides" ||
    value === "newBuildOverrides"
  );
}

export async function GET(request: NextRequest) {
  const gate = gateOnePathSimAdmin(request);
  if (gate) return gate;
  const { effectiveByMode, overrides } = await getOnePathSimulationVariablePolicy();
  return NextResponse.json({
    ok: true,
    confirmationKeyword: ONE_PATH_SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
    familyMeta: ONE_PATH_SIMULATION_VARIABLE_POLICY_FAMILY_META,
    defaults: ONE_PATH_DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG,
    effectiveByMode,
    overrides,
  });
}

export async function POST(request: NextRequest) {
  const gate = gateOnePathSimAdmin(request);
  if (gate) return gate;
  const body = await request.json().catch(() => null);
  const confirmation = String(body?.confirmation ?? "").trim();
  if (confirmation !== ONE_PATH_SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION) {
    return NextResponse.json(
      {
        ok: false,
        error: "override_confirmation_required",
        confirmationKeyword: ONE_PATH_SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
      },
      { status: 400 }
    );
  }

  if (body?.reset === true) {
    await resetOnePathSimulationVariableOverrides();
  } else {
    const existing = await getOnePathSimulationVariableOverrides();
    let nextOverrides: SimulationVariablePolicyOverrides = existing;
    if (isFamilyKey(body?.family)) {
      const rawOverride = body?.override && typeof body.override === "object" ? (body.override as Record<string, unknown>) : {};
      const familyOverride =
        isModeBucketKey(body?.modeBucket) &&
        !("sharedDefaults" in rawOverride) &&
        !("intervalOverrides" in rawOverride) &&
        !("manualMonthlyOverrides" in rawOverride) &&
        !("manualAnnualOverrides" in rawOverride) &&
        !("newBuildOverrides" in rawOverride)
          ? { [body.modeBucket]: rawOverride }
          : rawOverride;
      nextOverrides = {
        ...existing,
        [body.family]: familyOverride,
      };
    } else if (body?.overrides && typeof body.overrides === "object") {
      nextOverrides = body.overrides as SimulationVariablePolicyOverrides;
    } else {
      return NextResponse.json({ ok: false, error: "override_payload_required" }, { status: 400 });
    }
    await saveOnePathSimulationVariableOverrides(nextOverrides);
  }

  const { effectiveByMode, overrides } = await getOnePathSimulationVariablePolicy();
  return NextResponse.json({
    ok: true,
    confirmationKeyword: ONE_PATH_SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
    familyMeta: ONE_PATH_SIMULATION_VARIABLE_POLICY_FAMILY_META,
    defaults: ONE_PATH_DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG,
    effectiveByMode,
    overrides,
  });
}
