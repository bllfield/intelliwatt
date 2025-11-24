export const dynamic = "force-dynamic";

import React from "react";
import { Buffer } from "node:buffer";
import {
  getActivePeriodForTimestamp,
  getIntervalPricingForTimestamp,
  computeIntervalCharge,
  type PlanRules,
} from "@/lib/efl/planEngine";
import {
  deterministicEflExtract,
  type PdfTextExtractor,
} from "@/lib/efl/eflExtractor";

type PlanEngineTestResult = {
  ok: boolean;
  testTimestamp: string;
  activePeriod: unknown;
  pricing: unknown;
  intervalCharge: unknown;
};

type ExtractorTestResult = {
  ok: boolean;
  extract: {
    repPuctCertificate: string | null;
    eflVersionCode: string | null;
    warnings: string[];
    rawTextPreview: string;
  };
};

async function runPlanEngineSmokeTest(): Promise<PlanEngineTestResult> {
  const rules: PlanRules = {
    planType: "free-nights",
    defaultRateCentsPerKwh: 15,
    baseChargePerMonthCents: 0,
    timeOfUsePeriods: [
      {
        label: "Free Nights",
        startHour: 21,
        endHour: 7,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        months: undefined,
        rateCentsPerKwh: 0,
        isFree: true,
      },
    ],
    solarBuyback: null,
    billCredits: [],
  };

  const testTimestamp = new Date("2024-01-01T23:30:00-06:00");
  const activePeriod = getActivePeriodForTimestamp(rules, testTimestamp);
  const pricing = getIntervalPricingForTimestamp(rules, testTimestamp);
  const intervalCharge = computeIntervalCharge(
    rules,
    testTimestamp,
    0.25,
    0,
  );

  return {
    ok: true,
    testTimestamp: testTimestamp.toISOString(),
    activePeriod,
    pricing,
    intervalCharge,
  };
}

async function runDeterministicExtractorSmokeTest(): Promise<ExtractorTestResult> {
  const fakePdfBytes = Buffer.from("fake-efl-pdf-binary", "utf8");

  const fakeExtractor: PdfTextExtractor = async () => `
ELECTRICITY FACTS LABEL
PUCT Certificate: 10260
Ver. #: Free Nights 36_ONC_U_1205_995_15_09052025

Some other placeholder text that would normally appear in the EFL.
`.trim();

  const result = await deterministicEflExtract(fakePdfBytes, fakeExtractor);

  return {
    ok: true,
    extract: {
      repPuctCertificate: result.repPuctCertificate ?? null,
      eflVersionCode: result.eflVersionCode ?? null,
      warnings: result.warnings ?? [],
      rawTextPreview: result.rawText.slice(0, 300),
    },
  };
}

export default async function EflTestsPage() {
  let planEngineResult:
    | PlanEngineTestResult
    | { ok: false; error: string };
  let extractorResult:
    | ExtractorTestResult
    | { ok: false; error: string };

  try {
    planEngineResult = await runPlanEngineSmokeTest();
  } catch (err: any) {
    planEngineResult = {
      ok: false,
      error: err?.message ?? "Unknown error in PlanRules engine test",
    };
  }

  try {
    extractorResult = await runDeterministicExtractorSmokeTest();
  } catch (err: any) {
    extractorResult = {
      ok: false,
      error: err?.message ?? "Unknown error in deterministic extractor test",
    };
  }

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          EFL Fact Card Engine — Tests
        </h1>
        <p className="text-sm text-gray-500">
          Library-level smoke tests for the EFL → PlanRules engine. This page
          runs tests on each request (no database or external HTTP).
        </p>
      </header>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">PlanRules Engine Test</h2>
            <p className="text-xs text-gray-500">
              Exercises getActivePeriodForTimestamp,
              getIntervalPricingForTimestamp, and computeIntervalCharge using a
              simple free-nights PlanRules configuration.
            </p>
          </div>
        </div>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
          {JSON.stringify(planEngineResult, null, 2)}
        </pre>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Deterministic Extractor Test
            </h2>
            <p className="text-xs text-gray-500">
              Exercises deterministicEflExtract with a fake PDF and a custom
              PdfTextExtractor to verify repPuctCertificate and eflVersionCode
              parsing, plus warnings and text normalization.
            </p>
          </div>
        </div>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
          {JSON.stringify(extractorResult, null, 2)}
        </pre>
      </section>
    </div>
  );
}

