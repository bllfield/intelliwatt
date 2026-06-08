import {
  remapManualPastDatasetForDisplayWindow,
  resolveManualDisplayDatasetForRead,
} from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

export function remapManualDisplayDatasetToCanonicalWindow(args: {
  dataset: any;
  usageInputMode?: string | null;
  displayWindowEndDate?: string | null;
}) {
  return remapManualPastDatasetForDisplayWindow(args);
}

export { resolveManualDisplayDatasetForRead };
