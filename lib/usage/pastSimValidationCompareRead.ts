import {
  attachValidationCompareProjection,
  buildValidationCompareProjectionFromDatasets,
  buildValidationCompareProjectionSidecar,
  CompareTruthIncompleteError,
  type ValidationCompareProjectionSidecar,
} from "@/modules/usageSimulator/compareProjection";

/**
 * Past / One Path read: prefer attachValidationCompareProjection (meta.validationActualDailyKwhByDateLocal),
 * then fall back to dual-dataset compare when actual layer has validation-day totals.
 */
export function resolveValidationCompareProjectionForRead(args: {
  dataset: any;
  actualDataset?: any | null;
  displayDataset?: any | null;
}): ValidationCompareProjectionSidecar {
  const dataset = args.dataset;
  let working = dataset;
  try {
    const attached = attachValidationCompareProjection(working);
    const sidecar = buildValidationCompareProjectionSidecar(attached);
    if (sidecar.rows.length > 0) {
      return sidecar;
    }
    working = attached;
  } catch (error) {
    if (!(error instanceof CompareTruthIncompleteError)) {
      throw error;
    }
  }

  if (args.actualDataset && args.displayDataset) {
    try {
      return buildValidationCompareProjectionFromDatasets({
        validationSourceDataset: dataset,
        actualDataset: args.actualDataset,
        simulatedDataset: args.displayDataset,
      });
    } catch (error) {
      if (error instanceof CompareTruthIncompleteError) {
        return buildValidationCompareProjectionSidecar(working);
      }
      throw error;
    }
  }

  return buildValidationCompareProjectionSidecar(working);
}
