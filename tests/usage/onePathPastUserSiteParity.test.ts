import { describe, expect, it } from "vitest";
import {
  clearOnePathUserSiteParityFromBuildInputs,
  isParityBuildInputsDirty,
  readOnePathUserSiteParityLock,
  verifyPastDatasetParity,
} from "@/lib/usage/onePathPastUserSiteParityLock";

describe("onePathPastUserSiteParity", () => {
  it("readOnePathUserSiteParityLock rejects incomplete locks", () => {
    expect(readOnePathUserSiteParityLock(null)).toBeNull();
    expect(readOnePathUserSiteParityLock({ onePathUserSiteParity: { parityInputHash: "abc" } })).toBeNull();
  });

  it("readOnePathUserSiteParityLock returns a normalized lock", () => {
    const lock = readOnePathUserSiteParityLock({
      onePathUserSiteParity: {
        sourceUserId: "u1",
        sourceHouseId: "h1",
        sourceScenarioId: "s1",
        testScenarioId: "t1",
        parityInputHash: "hash-1",
        parityBuildInputsSnapshotHash: "snap-1",
        syncedAt: "2026-05-20T12:00:00.000Z",
        intervals15Count: 35040,
      },
    });
    expect(lock).toEqual({
      sourceUserId: "u1",
      sourceHouseId: "h1",
      sourceScenarioId: "s1",
      testScenarioId: "t1",
      parityInputHash: "hash-1",
      parityBuildInputsSnapshotHash: "snap-1",
      syncedAt: "2026-05-20T12:00:00.000Z",
      sourceIntervalCount: undefined,
      intervals15Count: 35040,
    });
  });

  it("isParityBuildInputsDirty compares snapshot hash", () => {
    const parity = readOnePathUserSiteParityLock({
      onePathUserSiteParity: {
        sourceUserId: "u1",
        sourceHouseId: "h1",
        sourceScenarioId: "s1",
        testScenarioId: "t1",
        parityInputHash: "hash-1",
        parityBuildInputsSnapshotHash: "wrong-snapshot",
        syncedAt: "2026-05-20T12:00:00.000Z",
      },
    })!;
    const buildInputs = {
      mode: "GREEN_BUTTON_BASELINE",
      weatherPreference: "LAST_YEAR_WEATHER",
      validationSelectionMode: "auto",
      validationDayCount: 5,
      travelRanges: [],
      validationOnlyDateKeysLocal: [],
    };
    expect(isParityBuildInputsDirty({ currentBuildInputs: buildInputs, parity })).toBe(true);
    expect(isParityBuildInputsDirty({ currentBuildInputs: buildInputs, parity: null })).toBe(false);
  });

  it("clearOnePathUserSiteParityFromBuildInputs removes the lock", () => {
    const cleared = clearOnePathUserSiteParityFromBuildInputs({
      mode: "SMT_BASELINE",
      onePathUserSiteParity: { parityInputHash: "x" },
    });
    expect(cleared.onePathUserSiteParity).toBeUndefined();
    expect(cleared.mode).toBe("SMT_BASELINE");
  });

  it("verifyPastDatasetParity compares fifteenMinuteAverages when present", () => {
    const curve = [{ hhmm: "00:00", avgKw: 1.2 }];
    const source = { insights: { fifteenMinuteAverages: curve }, series: { intervals15: [1] } };
    const test = { insights: { fifteenMinuteAverages: curve }, series: { intervals15: [1] } };
    expect(verifyPastDatasetParity({ sourceDataset: source, testDataset: test }).ok).toBe(true);

    const mismatch = { insights: { fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 9 }] }, series: { intervals15: [1] } };
    expect(verifyPastDatasetParity({ sourceDataset: source, testDataset: mismatch }).ok).toBe(false);
  });
});
