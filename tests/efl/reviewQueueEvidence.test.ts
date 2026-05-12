import { describe, expect, it } from "vitest";

import {
  getQueueEvidenceFingerprint,
  shouldWriteOpenQueueRowForEvidence,
  withQueueEvidenceFingerprint,
} from "@/lib/efl/reviewQueueEvidence";

describe("review queue evidence fingerprint gating", () => {
  it("keeps resolved plan-calc quarantine rows closed when the template fingerprint is unchanged", () => {
    const queueReason = JSON.stringify(
      withQueueEvidenceFingerprint(
        {
          type: "PLAN_CALC_QUARANTINE",
          offerId: "constellation-12",
        },
        "pcf_same",
      ),
    );

    expect(
      shouldWriteOpenQueueRowForEvidence({
        resolvedAt: new Date("2026-05-12T00:00:00.000Z"),
        queueReason,
        evidenceFingerprint: "pcf_same",
      }),
    ).toBe(false);
  });

  it("reopens resolved quarantine rows only when the template fingerprint changes", () => {
    const queueReason = JSON.stringify(
      withQueueEvidenceFingerprint(
        {
          type: "PLAN_CALC_QUARANTINE",
          offerId: "constellation-24",
        },
        "pcf_old",
      ),
    );

    expect(
      shouldWriteOpenQueueRowForEvidence({
        resolvedAt: new Date("2026-05-12T00:00:00.000Z"),
        queueReason,
        evidenceFingerprint: "pcf_new",
      }),
    ).toBe(true);
  });

  it("uses canonical EFL evidence for parse rows", () => {
    const queueReason = withQueueEvidenceFingerprint(
      {
        type: "EFL_PARSE",
        reason: "DASHBOARD_QUEUED",
      },
      "https://example.com/constellation.pdf",
    );

    expect(getQueueEvidenceFingerprint(queueReason)).toBe(
      "https://example.com/constellation.pdf",
    );
  });
});
