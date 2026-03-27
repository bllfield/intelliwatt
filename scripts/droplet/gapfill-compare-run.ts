/**
 * Droplet entry: `npx tsx scripts/droplet/gapfill-compare-run.ts <compareRunId>`
 * Prefer `scripts/droplet/sim-job-run.ts gapfill_compare <compareRunId>` for new wiring.
 */
import { runGapfillCompareQueuedWorker } from "../../modules/usageSimulator/gapfillCompareQueuedWorker";

const id = process.argv[2]?.trim();
if (!id) {
  console.error("Usage: npx tsx scripts/droplet/gapfill-compare-run.ts <compareRunId>");
  process.exit(1);
}

runGapfillCompareQueuedWorker(id)
  .then(() => {
    console.log("[gapfill-compare-run] ok", id);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[gapfill-compare-run] failed", err);
    process.exit(1);
  });
