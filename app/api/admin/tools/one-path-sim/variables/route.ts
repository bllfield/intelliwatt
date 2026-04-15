import { NextRequest, NextResponse } from "next/server";
import { gateOnePathSimAdmin } from "../_helpers";
import {
  DEFAULT_SIMULATION_VARIABLE_POLICY,
  SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
  SIMULATION_VARIABLE_POLICY_FAMILY_META,
  getSimulationVariablePolicy,
  getSimulationVariableOverrides,
  resetSimulationVariableOverrides,
  saveSimulationVariableOverrides,
  type SimulationVariablePolicy,
  type SimulationVariablePolicyOverrides,
} from "@/modules/usageSimulator/simulationVariablePolicy";

type FamilyKey = keyof SimulationVariablePolicy;

function isFamilyKey(value: unknown): value is FamilyKey {
  return typeof value === "string" && value in DEFAULT_SIMULATION_VARIABLE_POLICY;
}

export async function GET(request: NextRequest) {
  const gate = gateOnePathSimAdmin(request);
  if (gate) return gate;
  const { effective, overrides } = await getSimulationVariablePolicy();
  return NextResponse.json({
    ok: true,
    confirmationKeyword: SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
    familyMeta: SIMULATION_VARIABLE_POLICY_FAMILY_META,
    defaults: DEFAULT_SIMULATION_VARIABLE_POLICY,
    effective,
    overrides,
  });
}

export async function POST(request: NextRequest) {
  const gate = gateOnePathSimAdmin(request);
  if (gate) return gate;
  const body = await request.json().catch(() => null);
  const confirmation = String(body?.confirmation ?? "").trim();
  if (confirmation !== SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION) {
    return NextResponse.json(
      {
        ok: false,
        error: "override_confirmation_required",
        confirmationKeyword: SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
      },
      { status: 400 }
    );
  }

  if (body?.reset === true) {
    await resetSimulationVariableOverrides();
  } else {
    const existing = await getSimulationVariableOverrides();
    let nextOverrides: SimulationVariablePolicyOverrides = existing;
    if (isFamilyKey(body?.family)) {
      nextOverrides = {
        ...existing,
        [body.family]: body?.override && typeof body.override === "object" ? (body.override as Record<string, unknown>) : {},
      };
    } else if (body?.overrides && typeof body.overrides === "object") {
      nextOverrides = body.overrides as SimulationVariablePolicyOverrides;
    } else {
      return NextResponse.json({ ok: false, error: "override_payload_required" }, { status: 400 });
    }
    await saveSimulationVariableOverrides(nextOverrides);
  }

  const { effective, overrides } = await getSimulationVariablePolicy();
  return NextResponse.json({
    ok: true,
    confirmationKeyword: SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION,
    familyMeta: SIMULATION_VARIABLE_POLICY_FAMILY_META,
    defaults: DEFAULT_SIMULATION_VARIABLE_POLICY,
    effective,
    overrides,
  });
}
