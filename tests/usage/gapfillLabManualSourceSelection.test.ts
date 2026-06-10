import { describe, expect, it } from "vitest";
import {
  isGapfillManualLabRuntimeHouse,
  pickGapfillManualLabSourceHouseId,
} from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import { GAPFILL_LAB_TEST_HOME_LABEL } from "@/modules/usageSimulator/labTestHomeLabels";

describe("pickGapfillManualLabSourceHouseId", () => {
  const candidates = [
    {
      id: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      esiid: null,
      label: "167 Jessica Drive, Aledo, TX",
      addressLine1: "167 Jessica Drive",
    },
    {
      id: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      esiid: "10400511114390001",
      label: "146 Valley View Drive, Lewisville, TX",
      addressLine1: "146 Valley View Drive",
    },
  ];

  it("prefers the SMT source with ESIID over a stale linked source without meter data", () => {
    expect(
      pickGapfillManualLabSourceHouseId({
        candidates,
        linkedSourceHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
        testHomeHouseId: "9e2a8bff-4a66-4f00-a08f-a07993af3f19",
      })
    ).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
  });

  it("keeps an explicit requested SMT source when it has an ESIID", () => {
    expect(
      pickGapfillManualLabSourceHouseId({
        candidates,
        requestedSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
        linkedSourceHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
        testHomeHouseId: "9e2a8bff-4a66-4f00-a08f-a07993af3f19",
      })
    ).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
  });

  it("excludes the active lab runtime house from source candidates", () => {
    expect(
      isGapfillManualLabRuntimeHouse({
        houseId: "9e2a8bff-4a66-4f00-a08f-a07993af3f19",
        label: GAPFILL_LAB_TEST_HOME_LABEL,
        testHomeHouseId: "9e2a8bff-4a66-4f00-a08f-a07993af3f19",
      })
    ).toBe(true);
  });
});
