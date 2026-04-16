/**
 * Durable queued compare payload for droplet async execution (replay without original HTTP body).
 */
export const GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION = 1 as const;

export type GapfillCompareQueuedPayloadV1 = {
  version: typeof GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION;
  userId: string;
  houseId: string;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  canonicalMonths: string[];
  canonicalWindowHelper: string;
  esiid: string | null;
  testDateKeysLocal: string[];
  testRanges: Array<{ startDate: string; endDate: string }>;
  testRangesUsed: Array<{ startDate: string; endDate: string }>;
  testSelectionMode: "manual_ranges" | "random_days";
  testDaysRequested: number | null;
  testDaysSelected: number;
  seedUsed: string | null;
  testMode: string;
  candidateDaysAfterModeFilterCount: number | null;
  candidateWindowStart: string | null;
  candidateWindowEnd: string | null;
  excludedFromTest_travelCount: number;
  travelRangesFromDb: Array<{ startDate: string; endDate: string }>;
  includeDiagnostics: boolean;
  includeFullReportText: boolean;
  rebuildArtifact: boolean;
  requestedArtifactInputHash: string | null;
  requestedArtifactScenarioId: string | null;
  requireExactArtifactMatch: boolean;
  artifactIdentitySource: string | null;
  heavyOnlyCompactResponse: boolean;
  requestedCompareRunId: string | null;
  minDayCoveragePct: number;
};

export function buildGapfillCompareQueuedPayloadV1(args: {
  userId: string;
  houseId: string;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  canonicalMonths: string[];
  canonicalWindowHelper: string;
  esiid: string | null;
  testDateKeysLocal: Set<string>;
  testRanges: Array<{ startDate: string; endDate: string }>;
  testRangesUsed: Array<{ startDate: string; endDate: string }>;
  testSelectionMode: "manual_ranges" | "random_days";
  testDaysRequested: number | null;
  testDaysSelected: number;
  seedUsed: string | null;
  testMode: string;
  candidateDaysAfterModeFilterCount: number | null;
  candidateWindowStart: string | null;
  candidateWindowEnd: string | null;
  excludedFromTest_travelCount: number;
  travelRangesFromDb: Array<{ startDate: string; endDate: string }>;
  includeDiagnostics: boolean;
  includeFullReportText: boolean;
  rebuildArtifact: boolean;
  requestedArtifactInputHash: string | null;
  requestedArtifactScenarioId: string | null;
  requireExactArtifactMatch: boolean;
  artifactIdentitySource: string | null;
  heavyOnlyCompactResponse: boolean;
  requestedCompareRunId: string | null;
  minDayCoveragePct: number;
}): GapfillCompareQueuedPayloadV1 {
  return {
    version: GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION,
    userId: args.userId,
    houseId: args.houseId,
    timezone: args.timezone,
    canonicalWindow: args.canonicalWindow,
    canonicalMonths: args.canonicalMonths,
    canonicalWindowHelper: args.canonicalWindowHelper,
    esiid: args.esiid,
    testDateKeysLocal: Array.from(args.testDateKeysLocal).sort(),
    testRanges: args.testRanges,
    testRangesUsed: args.testRangesUsed,
    testSelectionMode: args.testSelectionMode,
    testDaysRequested: args.testDaysRequested,
    testDaysSelected: args.testDaysSelected,
    seedUsed: args.seedUsed,
    testMode: args.testMode,
    candidateDaysAfterModeFilterCount: args.candidateDaysAfterModeFilterCount,
    candidateWindowStart: args.candidateWindowStart,
    candidateWindowEnd: args.candidateWindowEnd,
    excludedFromTest_travelCount: args.excludedFromTest_travelCount,
    travelRangesFromDb: args.travelRangesFromDb,
    includeDiagnostics: args.includeDiagnostics,
    includeFullReportText: args.includeFullReportText,
    rebuildArtifact: args.rebuildArtifact,
    requestedArtifactInputHash: args.requestedArtifactInputHash,
    requestedArtifactScenarioId: args.requestedArtifactScenarioId,
    requireExactArtifactMatch: args.requireExactArtifactMatch,
    artifactIdentitySource: args.artifactIdentitySource,
    heavyOnlyCompactResponse: args.heavyOnlyCompactResponse,
    requestedCompareRunId: args.requestedCompareRunId,
    minDayCoveragePct: args.minDayCoveragePct,
  };
}

